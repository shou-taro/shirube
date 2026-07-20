/** Keys for the small amount of state shirube keeps in the browser's localStorage. */

/** The profile id to reconnect to on load (see App). */
export const ACTIVE_PROFILE_KEY = 'shirube.activeProfileId'

/** The user's saved settings (see settings). */
export const SETTINGS_KEY = 'shirube.settings'

/** Destinations the user has agreed the navigator may send the schema to (see destinations). */
export const APPROVED_DESTINATIONS_KEY = 'shirube.approvedDestinations'

/** Which provider preset the user picked, so the UI names it the same way they chose it. */
export const AI_PRESET_KEY = 'shirube.aiProviderPreset'

/** Prefix for a profile's navigator conversation; the profile id completes it (see chat-history). */
export const CHAT_HISTORY_PREFIX = 'shirube.chat.'
