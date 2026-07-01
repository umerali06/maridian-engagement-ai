import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

export const perSubscriberLimit = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "rl:sub",
});

export const perIpLimit = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(100, "60 s"),
  analytics: true,
  prefix: "rl:ip",
});
