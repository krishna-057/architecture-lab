export function retryBaseDelaySeconds({ attemptNumber, retryDelaysSeconds }) {
  const index = Math.min(Math.max(attemptNumber - 1, 0), retryDelaysSeconds.length - 1);
  return retryDelaysSeconds[index];
}

export function calculateRetrySchedule({
  attemptNumber,
  retryDelaysSeconds,
  retryJitterRatio,
  nowMs = Date.now(),
  random = Math.random
}) {
  const baseDelaySeconds = retryBaseDelaySeconds({ attemptNumber, retryDelaysSeconds });
  const jitterWindowSeconds = Math.round(baseDelaySeconds * retryJitterRatio);
  const jitterOffsetSeconds =
    jitterWindowSeconds === 0 ? 0 : Math.round((random() * 2 - 1) * jitterWindowSeconds);
  const scheduledDelaySeconds = Math.max(0, baseDelaySeconds + jitterOffsetSeconds);

  return {
    base_delay_seconds: baseDelaySeconds,
    jitter_seconds: jitterOffsetSeconds,
    scheduled_delay_seconds: scheduledDelaySeconds,
    next_attempt_at: new Date(nowMs + scheduledDelaySeconds * 1000).toISOString()
  };
}
