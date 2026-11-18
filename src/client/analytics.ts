import { telemetry } from '@devvit/analytics/client/reddit';

let journeyStarted = false;

export async function trackAppReady(): Promise<void> {
  try {
    await telemetry.appReady();
  } catch {
    // Non-blocking in local preview or when telemetry is unavailable
  }
}

export async function trackJourneyStart(): Promise<void> {
  if (journeyStarted) return;
  journeyStarted = true;
  try {
    await telemetry.startJourney();
  } catch {
    // Ignore telemetry errors
  }
}

export async function trackJourneyProgress(
  progress: number,
  action: string,
  actionDetails?: string
): Promise<void> {
  try {
    if (!journeyStarted) {
      await trackJourneyStart();
    }
    await telemetry.progress({
      progress: Math.max(0, Math.min(1, progress)),
      action,
      ...(actionDetails ? { actionDetails } : {}),
    });
  } catch {
    // Ignore telemetry errors
  }
}

export async function trackJourneyInteraction(
  action: string,
  actionDetails?: string
): Promise<void> {
  try {
    if (!journeyStarted) return;
    await telemetry.interaction({
      action,
      ...(actionDetails ? { actionDetails } : {}),
    });
  } catch {
    // Ignore telemetry errors
  }
}

export async function trackJourneyEnd(complete: boolean): Promise<void> {
  try {
    if (!journeyStarted) return;
    await telemetry.endJourney({ complete });
    journeyStarted = false;
  } catch {
    // Ignore telemetry errors
  }
}
