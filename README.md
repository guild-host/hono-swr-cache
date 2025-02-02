# @guild-host/hono-swr-cache

This library is meant to be a drop-in replacement for Hono's Cache Middleware, accepting the same options and providing additional `stale-while-revalidate` support (`stale-if-error` coming soon!)

WIP

## Problem that this aims to solve

We use Cloudflare Workers to serve basically everything that a user touches. Unfortunately, the Workers Cache API [does not support `stale-while-revalidate` and `stale-if-error` directives](https://developers.cloudflare.com/workers/runtime-apis/cache/#methods).

Folks have implemented these directives on top of the Cache API, by utilizing additional headers on the Response to achieve the desired result.

This repo attempts to provide that as Hono middleware, so it's easy to plug into any Hono application that can then be served through Cloudflare and other providers.

## Roadblock

It appears that Hono middleware can only process 1 response per request.

The nature of a `stale-while-revalidate` workflow is that you return 1 response while revalidating at least 1 more response in the background.

There are some hacky workarounds within Hono, but nothing that provides me with confidence that any of these hacks are a reliable path forward.

Thus, this repo serves as an example of what I'd like to accomplish, with a test suite that has a failing test describing my desired behaviour. Check out the Actions in this repo for an example of a test run.

## Workaround

Instead of a Hono middleware-based approach, I may explore a higher level approach that wraps the Hono application entirely.

This would leave that wrapper to be able to make multiple calls within Hono, to revalidate as needed.

However, I think Hono middleware would be nicer syntactically so hopefully we can work with the Hono team on a solution here :heart:

### Inspiration

Heavily inspired by / code adapted from:

- https://hono.dev/docs/middleware/builtin/cache
- https://gist.github.com/wilsonpage/a4568d776ee6de188999afe6e2d2ee69

Thank you! :bow:

### License

MIT
