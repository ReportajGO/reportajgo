import { Queue } from "bullmq";
import { QUEUE_NAMES, connection } from "./connection.js";

const opts = { connection };

export const pipelineQueue = new Queue(QUEUE_NAMES.pipeline, opts);
export const publishQueue = new Queue(QUEUE_NAMES.publish, opts);
export const schedulerQueue = new Queue(QUEUE_NAMES.scheduler, opts);
export const mediaQueue = new Queue(QUEUE_NAMES.media, opts);

export interface PublishJobData {
  scheduledPostId: string;
}
