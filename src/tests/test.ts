import { Scraper } from '@src/index';

const cookie = 'Cookie';

const redditScraper = new Scraper(cookie, './tempVideoFiles');

(async () => {
	const test = await redditScraper.fetchPost('https://www.reddit.com/r/LiveFromNewYork/comments/1fdehf1/really_sweet_post_from_my_local_comedy_club_about');

	console.log(test);
})();