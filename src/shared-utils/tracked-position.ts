import { Position } from "../core/evaluate-exit";
import { redis } from "./redis-client";

export const setTrackedPosition = async (coin: string, position: object) => {
    await redis.set(`position:${coin}`, JSON.stringify(position), { EX: 86400 }); // 24h
};
