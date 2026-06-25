import { Queue } from "bullmq";
import { QUEUE_NAMES, connection } from "./connection.js";

const opts = { connection };

export const pipelineQueue = new Queue(QUEUE_NAMES.pipeline, opts);
export const publishQueue = new Queue(QUEUE_NAMES.publish, opts);
export const schedulerQueue = new Queue(QUEUE_NAMES.scheduler, opts);

export interface PublishJobData {
  scheduledPostId: string;
}
