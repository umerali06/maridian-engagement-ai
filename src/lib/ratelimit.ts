import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
let _perSubscriberLimit: Ratelimit | null = null;
let _perIpLimit: Ratelimit | null = null;

function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

export function getPerSubscriberLimit(): Ratelimit {
  if (!_perSubscriberLimit) {
    _perSubscriberLimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      analytics: true,
      prefix: "rl:sub",
    });
  }
  return _perSubscriberLimit;
}

export function getPerIpLimit(): Ratelimit {
  if (!_perIpLimit) {
    _perIpLimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(100, "60 s"),
      analytics: true,
      prefix: "rl:ip",
    });
  }
  return _perIpLimit;
}
