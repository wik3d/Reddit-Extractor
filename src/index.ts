import { proxyType } from './types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as Path from 'path';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import { readFile } from 'fs/promises';
import { path } from '@ffmpeg-installer/ffmpeg';
ffmpeg.setFfmpegPath(path);

export class Scraper {
	private requestOptions: { headers: HeadersInit, agent?: HttpsProxyAgent<string> };
	private downloadPath: string;

	constructor(public cookie: string, downloadPath: string = './', private proxy?: proxyType) {
		if (!cookie) throw new Error('A Reddit account cookie must be provided');

		this.downloadPath = downloadPath;
		this.ensureDirectoryExists(this.downloadPath);

		this.requestOptions = {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8',
				'Accept-Language': 'en-GB,en;q=0.5',
				'Accept-Encoding': 'gzip, deflate, br, zstd',
				'Upgrade-Insecure-Requests': '1',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'none',
				'Sec-Fetch-User': '?1',
				'Connection': 'keep-alive',
				'Cookie': this.cookie,
				'Priority': 'u=0, i',
				'TE': 'trailers',
			},
		};

		if (proxy) {
			const proxyAgent = new HttpsProxyAgent(
				`${this.proxy.protocol}://${Object.keys(this.proxy.auth || {}).length > 0 ? `${this.proxy.auth?.username}:${this.proxy.auth?.password}` : ''}@${this.proxy.host}:${this.proxy.port}`,
			);
			this.requestOptions.agent = proxyAgent;
		}
	}

	public async fetchPost(postUrl: string) {
		try {
			// Convert the post url to the reddit's JSON API
			const jsonUrl = `${postUrl}.json`;

			// Fetch the JSON data of the reddit post
			const response = await fetch(jsonUrl, this.requestOptions);
			if (!response.ok) throw new Error('403 Unauthorized, bad cookie maybe?');

			const jsonData = await response.json();

			const post = jsonData[0]?.data?.children?.[0]?.data;
			const subreddit = jsonData[0]?.data?.children?.[0]?.data?.subreddit_name_prefixed || null;
			const title = post?.title || null;
			const description = post?.selftext || null;
			let externalUrl: string;
			const mediaBuffers: Buffer[] = [];

			// Basically if any URL contains 'amp;' then it wont work. Im so lucky I even found this out cuz otherwise that wouldve been so much hassle
			const cleanUrl = (url: string) => url.replace(/amp;/g, '');

			// Handle image URLs
			if (post?.preview?.images) {
				for (const image of post.preview.images) {
					let url = image.source.url;

					// If it's a GIF with format=png, use the URL from variants
					if (url.includes('.gif') && url.includes('?format=png') && image.variants?.gif?.source?.url) {
						url = cleanUrl(image.variants.gif.source.url);
					}

					// Get rid of any external preview cuz they're low quality and just not needed
					if (!url.startsWith('https://external-preview')) {
						const fetchedImage = await fetch(cleanUrl(url));
						const arrayBuffer = await fetchedImage.arrayBuffer();
						const buffer = Buffer.from(arrayBuffer);
						mediaBuffers.push(buffer);
					}
				}
			}

			// Sometimes it has media_metadata and other times it doesn't, not really sure as to why but there is never both from what I've tested, there should be no duplicates
			if (post?.media_metadata) {
				for (const media of Object.values(post.media_metadata)) {
					const fetchedImage = await fetch(cleanUrl((media as { s: { u: string } }).s.u));
					const arrayBuffer = await fetchedImage.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);
					mediaBuffers.push(buffer);
				}
			}

			// Handle video URLs
			if (post?.secure_media?.reddit_video?.fallback_url) {
				const url = `${post.url}/DASHPlaylist.mpd`;

				const URLs = await this.fetchDASHPlaylist(url).then(this.parseDASHPlaylist);

				if (URLs.audioUrl) {
					const videoUrl = `${post.url}/${URLs.videoUrl}`;
					const audioUrl = `${post.url}/${URLs.audioUrl}`;
		
					const fileID = Date.now();
		
					const videoPath = Path.resolve(this.downloadPath, `${fileID}_${URLs.videoUrl}`);
					const audioPath = Path.resolve(this.downloadPath, `${fileID}_${URLs.audioUrl}`);
		
					try {
						await Promise.all([
							this.downloadFile(videoUrl, videoPath),
							this.downloadFile(audioUrl, audioPath),
						]);
						console.log('Media files downloaded successfully.');
					}
					catch (err) {
						console.error('Error downloading media files:', err);
					}
		
					const combinedOutput = Path.resolve(this.downloadPath, `video_${fileID}.mp4`);
					await this.combineVideoAndAudio(videoPath, audioPath, combinedOutput);
		
					// Delete the separate audio and video files after combining them
					fs.unlinkSync(videoPath);
					fs.unlinkSync(audioPath);
					
					// Push combined file URL to media array
					mediaBuffers.push(await readFile(combinedOutput));
					fs.unlinkSync(combinedOutput);
					if (post.url) post.url = null;

					console.log('Deleted video and audio files after combining.');
					console.log(mediaBuffers);
				}

			}

			// Handle any external URLs
			if (post?.url) {
				if (!this.hasFileExtension(post.url) && !post.url.includes('/gallery') && mediaBuffers.every(url => !url.includes(post.url && '.mp4'))) {
					externalUrl = post.url;
				}
			}

			const postData = {
				subreddit,
				title: title?.trim(),
				description: description?.trim() ?? null,
				media: mediaBuffers.filter(Boolean) || null,
				externalUrl: externalUrl || null,
			};

			return postData;
		}
		catch (error) {
			console.error('Error fetching the post:', error);
		}
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
			console.log(JSON.stringify(result, null, 2));
	
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
					console.log('Combining finished');
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