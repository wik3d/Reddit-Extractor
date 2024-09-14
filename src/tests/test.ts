import { Scraper } from '@src/index';

const proxyConfig = {
	protocol: '',
	host: '',
	port: 12321,
	auth: {
		username: '',
		password: '',
	},
};

const redditScraper = new Scraper('./tempVideoFiles', proxyConfig);

(async () => {
	const test = await redditScraper.fetchPost('https://www.reddit.com/r/buildapc/comments/1fgnai4/rtx_4070_vs_4070_ti_vs_4070_super/');

	console.log(test);
})();