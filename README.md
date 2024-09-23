# Reddit-Extractor <img align="left" width="132" height="132" src="./logo.jpeg">

An effective Reddit post fetcher, bypassing JSON API restrictions with proxies.
<br><br><br>
## Overview
Reddit's [JSON API](https://www.reddit.com/r/mac/comments/1fcx4p2/macos_sequoia_will_be_released_on_september_16th.json) is publicly available, no authentication is needed.<br><br>
However, Rate Limits obviously apply to this endpoint, so my wrapper aims to work around this issue with the fully automated use of randomized cookies per request, and proxies if a rate limit is applied

## Installation
```console
npm i reddit-extractor
```

## Usage
```ts
import { Scraper, Post } from 'reddit-extractor';

// Proxies are not required, but recommended for large applications (Only http(s) proxies are supported)
// Reddit's JSON API rate limits if you make ~100 requests within quick succession
const proxyConfig = {
	protocol: 'http',
	host: '',
	port: 12321,
	auth: {
		username: '',
		password: '',
	},
};

const RedditExtractor = new Scraper('./tempFiles', proxyConfig);
```
<br>

### Get a single Post
```ts
const postUrl = 'https://www.reddit.com/r/mac/comments/1fcx4p2/macos_sequoia_will_be_released_on_september_16th/';
const postData = await Scraper.fetchPost(postUrl);

if ('error' in post) {
	return console.error('Error in post', post.error);
}

console.log(postData);
```
<br>

### Get recent posts from a subreddit
```ts
// Will return the 5 most recent posts from r/memes
const subreddit = 'memes';
const latestFivePosts = await redditScraper.fetchPosts(subreddit, 5);
if (!latestFivePosts.length) return console.error('No posts found');

const mostRecentPostData = latestFivePosts[0];

if ('error' in mostRecentPostData) {
	return console.error('Error in most recent post', mostRecentPostData.error);
}

console.log(mostRecentPostData);
```
