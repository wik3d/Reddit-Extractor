# Reddit-Extractor <img align="left" width="132" height="132" src="./logo.jpeg">

An effective Reddit post fetcher, bypassing JSON API restrictions with proxies.
<br><br><br>
## Overview
Reddit's [JSON API](https://www.reddit.com/r/mac/comments/1fcx4p2/macos_sequoia_will_be_released_on_september_16th.json) is publicly available, no authentication is needed.<br><br>
However, Rate Limits obviously apply to this endpoint, so my wrapper aims to work arond this issue with the fully automated use of randomized cookies per request, and proxies if a rate limit is applied
