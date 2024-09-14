import { Scraper } from '../index';

const proxyConfig = {
	protocol: '',
	host: '',
	port: 12321,
	auth: {
		username: '',
		password: '',
	},
};

const testUrl = 'https://www.reddit.com/r/buildapc/comments/1fgnai4/rtx_4070_vs_4070_ti_vs_4070_super/';

const runStressTest = async () => {
	const scraper = new Scraper('./tempVideoFiles', proxyConfig);

	const fetchPost = async (url: string) => {
		try {
			const post = await scraper.fetchPost(url);
			console.log('Fetched post:', post);
		}
		catch (error) {
			console.error('Error fetching post:', error);
		}
	};

	console.log('Starting stress test...');

	for (let i = 1; i <= 2000; i++) {
		console.log(`Fetching post ${i}`);
		await fetchPost(testUrl);
	}

	console.log('Stress test completed.');
};

runStressTest().catch(console.error);