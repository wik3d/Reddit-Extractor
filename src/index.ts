import { Media, Post, proxyType } from './types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as Path from 'path';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import { readFile } from 'fs/promises';
import { path } from '@ffmpeg-installer/ffmpeg';
import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
ffmpeg.setFfmpegPath(path);

export class Scraper {
	private agent: InstanceType<typeof HttpsProxyAgent>;
	private downloadPath: string;
	private usingProxies = false;
	private proxySwitchTimeout: NodeJS.Timeout | null = null;
	private jar: CookieJar;

	constructor(downloadPath: string = './', private proxy?: proxyType, private forceProxy = false) {
		this.downloadPath = downloadPath;
		this.ensureDirectoryExists(this.downloadPath);
		this.jar = new CookieJar();

		if (proxy) {
			const proxyAgent = new HttpsProxyAgent(
				`${this.proxy.protocol}://${Object.keys(this.proxy.auth || {}).length > 0 ? `${this.proxy.auth?.username}:${this.proxy.auth?.password}` : ''}@${this.proxy.host}:${this.proxy.port}`,
			);
			this.agent = proxyAgent;
		}
	}

	public async fetchPost(postUrl: string): Promise<Post | { error: string }> {
		// Convert the post url to the reddit's JSON API url
		const jsonUrl = `${postUrl}.json`;

		try {
			// Fetch the JSON data of the reddit post
			const response = await this.fetchWithRetry(jsonUrl);

			const post = response.data[0]?.data?.children?.[0]?.data;
			const authorName = post?.author || null;
			const subreddit = post?.subreddit_name_prefixed || null;
			const title = post?.title || null;
			const description = post?.selftext || null;
			let externalUrl: string;
			const mediaObjects: Media[] = [];
			const upVotes = post?.ups || 0;
			const downVotes = upVotes ? Math.ceil((1 - post?.upvote_ratio) * upVotes) : 0;
			const comments = post?.num_comments || 0;
			const postedAt = post?.created_utc;
			const isOver18: boolean = post?.over_18;

			if (description === '[deleted]') return { error: 'Post has been deleted' };

			// Basically if any media URL contains 'amp;' then it wont work, so we need to remove
			const cleanUrl = (url: string) => url.replace(/amp;/g, '');

			// Handle image URLs
			if (post?.preview?.images) {
				for (const image of post.preview.images) {
					let url = image.source.url;
					let type: 'image' | 'gif' = 'image';

					// If it's a GIF with format=png, use the URL from variants
					if (url.includes('.gif') && url.includes('?format=png') && image.variants?.gif?.source?.url) {
						url = cleanUrl(image.variants.gif.source.url);
						type = 'gif';
					}

					// Get rid of any external preview cuz they're low quality and just not needed
					if (!url.startsWith('https://external-preview')) {
						const fetchedImage = await fetch(cleanUrl(url));
						const arrayBuffer = await fetchedImage.arrayBuffer();
						const buffer = Buffer.from(arrayBuffer);
						mediaObjects.push({
							type,
							buffer,
						});
					}
				}
			}

			// Sometimes it has media_metadata and other times it doesn't, not really sure as to why but there is never both from what I've tested, there should be no duplicates
			if (post?.media_metadata) {
				for (const media of Object.values(post.media_metadata)) {
					const fetchedImage = await fetch(cleanUrl((media as { s: { u: string } }).s.u));
					let type: 'image' | 'gif';
	
					if ((media as { e: string }).e == 'Image') {
						type = 'image';
					}
					else {
						type = 'gif';
					}
	
					const arrayBuffer = await fetchedImage.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);
					mediaObjects.push({
						type,
						buffer,
					});
				}
			}

			// Handle video URLs
			if (post?.secure_media?.reddit_video?.fallback_url) {
				const url = `${post.url}/DASHPlaylist.mpd`;
				const fileID = Date.now();
				const URLs = await this.fetchDASHPlaylist(url).then(this.parseDASHPlaylist);

				if (URLs.audioUrl) {
					const videoUrl = `${post.url}/${URLs.videoUrl}`;
					const audioUrl = `${post.url}/${URLs.audioUrl}`;
					const videoPath = Path.resolve(this.downloadPath, `${fileID}_${URLs.videoUrl}`);
					const audioPath = Path.resolve(this.downloadPath, `${fileID}_${URLs.audioUrl}`);
					const combinedOutputPath = Path.resolve(this.downloadPath, `video_${fileID}.mp4`);

					try {
						await Promise.all([
							this.downloadFile(videoUrl, videoPath),
							this.downloadFile(audioUrl, audioPath),
						]);

						await this.combineVideoAndAudio(videoPath, audioPath, combinedOutputPath);

						// Push combined file data to media array
						mediaObjects.push({
							type: 'video',
							buffer: await readFile(combinedOutputPath),
						});
					}
					catch (err) {
						console.error('Error combining video and audio', err);
					}
					finally {
						// Delete the separate audio and video files after combining or even if an error occurs
						fs.unlinkSync(videoPath);
						fs.unlinkSync(audioPath);
						fs.unlinkSync(combinedOutputPath);
						if (post.url) post.url = null;
					}
				}
				else if (post?.secure_media?.reddit_video?.is_gif) {
					const videoPath = Path.resolve(this.downloadPath, `${fileID}_${URLs.videoUrl}`);
					const videoUrl = `${post.url}/${URLs.videoUrl}`;

					try {
						await this.downloadFile(videoUrl, videoPath);
	
						mediaObjects.push({
							type: 'video',
							buffer: await readFile(videoPath),
						});
					}
					catch (err) {
						console.error('Error during gif (video) download', err);
					}
					finally {
						fs.unlinkSync(videoPath);
						if (post.url) post.url = null;
					}
				}
			}

			// Handle any external URLs
			if (post?.url) {
				if (!this.hasFileExtension(post.url) && !post.url.includes('/gallery') && !post.url.includes(post.subreddit)) {
					externalUrl = post.url;
				}
			}

			const postData: Post = {
				author: authorName || null,
				subreddit,
				title: title?.trim(),
				description: description?.trim() === '' ? null : description?.trim(),
				media: mediaObjects || null,
				externalUrl: externalUrl || null,
				upVotes,
				downVotes,
				comments,
				isOver18,
				postedAt,
			};

			return postData;
		}
		catch (error) {
			console.error('Error fetching the post:', error);
			return { error: error.message || 'An unknown error occurred' };
		}
	}

	// Makes requests with a new set of cookies each time by clearing the cookie jar after each request
	private async makeRequest(url: string, agent: InstanceType<typeof HttpsProxyAgent> | null = null) {
		const fetchWithCookies = fetchCookie(fetch, this.jar);

		const headers = {
			'Connection': 'close',
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response = await fetchWithCookies(url, { agent, headers } as any) as unknown as Response;

		if (!response.ok) {
			throw new Error(`Request failed with status: ${response.status}`);
		}

		const data = await response.json();
		const cookies = await this.jar.removeAllCookies();

		return { data, cookies };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async fetchWithRetry(url: string, retries: number = 5): Promise<any> {
		let agent: InstanceType<typeof HttpsProxyAgent> | null = null;
    
		if ((this.usingProxies && this.agent) || this.forceProxy) {
			agent = this.agent;
		}

		try {
			const response = await this.makeRequest(url, agent);
			return response;
		}
		catch (error) {
			if (retries <= 0) {
				console.error('Max retries (5) reached. Throwing error.');
				throw error;
			}

			if (error.message.includes('403')) {
				console.error(`Error 403 encountered: ${error.message}. Retrying with new cookie... (${5 - retries + 1})`);
				return this.fetchWithRetry(url, retries - 1);
			}
			else if (error.message.includes('429')) {
				if (!this.usingProxies && this.agent) {
					console.error(`Error 429 encountered: ${error.message}. Switching to proxy if available... (${5 - retries + 1})`);
					this.activateProxyMode();
				}
				return this.fetchWithRetry(url, retries - 1);
			}
			else if (error.code === 'ECONNRESET') {
				console.error(`Network error encountered: ${error.message}. Retrying request... (${5 - retries + 1})`);
				return this.fetchWithRetry(url, retries - 1);
			}
			else {
				throw error;
			}
		}
	}

	private activateProxyMode() {
		this.usingProxies = true;

		// If there's an existing timeout, clear it
		if (this.proxySwitchTimeout) {
			clearTimeout(this.proxySwitchTimeout);
		}

		// Set a timeout to switch back to main IP after 5 minutes
		this.proxySwitchTimeout = setTimeout(() => {
			this.usingProxies = false;
		}, 5 * 60 * 1000);
	}

	private async fetchDASHPlaylist(playlistUrl: string): Promise<string> {
		try {
			const response = await axios.get(playlistUrl);
			return response.data;
		}
		catch (error) {
			console.error('Error fetching DASH playlist:', error);
			throw error;
		}
	}
	
	private async parseDASHPlaylist(xmlData: string): Promise<{ videoUrl: string, audioUrl: string }> {
		try {
			const result = await parseStringPromise(xmlData);
	
			const mediaUrls: { videoUrl: string, audioUrl: string } = { videoUrl: '', audioUrl: '' };
	
			// Extract URLs from the parsed XML
			const mpd = result.MPD;
			if (!mpd || !mpd.Period || !mpd.Period[0] || !mpd.Period[0].AdaptationSet) {
				console.error('Invalid MPD structure:', mpd);
				throw new Error('Invalid MPD structure');
			}
	
			const adaptationSets = mpd.Period[0].AdaptationSet;
			
			// Process each AdaptationSet
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			adaptationSets.forEach((set: any) => {
				const contentType = set.$.contentType;
				const representations = set.Representation || [];
	
				if (contentType === 'video') {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					representations.forEach((rep: any) => {
						if (rep.$.mimeType === 'video/mp4' && rep.BaseURL && rep.BaseURL.length > 0) {
							mediaUrls.videoUrl = rep.BaseURL[0];
						}
					});
				}
				
				if (contentType === 'audio') {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					representations.forEach((rep: any) => {
						if (rep.$.mimeType === 'audio/mp4' && rep.BaseURL && rep.BaseURL.length > 0) {
							mediaUrls.audioUrl = rep.BaseURL[0];
						}
					});
				}
			});
	
			return mediaUrls;
		}
		catch (error) {
			console.error('Error parsing DASH playlist:', error);
			throw error;
		}
	}
	
	private async downloadFile(url: string, outputPath: string) {
		const writer = fs.createWriteStream(outputPath);
	
		const response = await axios({
			url,
			method: 'GET',
			responseType: 'stream',
		});
	
		response.data.pipe(writer);
	
		return new Promise<void>((resolve, reject) => {
			writer.on('finish', () => resolve());
			writer.on('error', (err) => reject(err));
		});
	}
	
	private async combineVideoAndAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			ffmpeg()
				.input(videoPath)
				.input(audioPath)
				.audioCodec('aac')
				.videoCodec('libx264')
				.output(outputPath)
				.on('end', () => {
					resolve();
				})
				.on('error', (err) => {
					console.error('Error combining files:', err);
					reject(err);
				})
				.run();
		});
	}

	private hasFileExtension(url: string): boolean {
		const extensionPattern = /\.[a-zA-Z0-9]+$/;
		return extensionPattern.test(url);
	}

	private ensureDirectoryExists(directory: string) {
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true });
		}
	}
}