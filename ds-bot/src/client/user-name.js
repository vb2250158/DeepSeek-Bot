// Who signs the user's own rows, resolved from the shell account snapshot alone: no
// React, so the rule stays testable outside a browser.
import { t } from './i18n.js'

/**
 * The signed-in account's display name and picture. A stored credential counts as
 * signed in, as it does on the Account page; the profile arrives a moment later, so the
 * name stays the plain one until it does. Without a picture — or without an account at
 * all — the row draws DSH's own mark instead.
 * @param snapshot - the account plugin's snapshot, absent while that plugin is off.
 * @returns the name to print and the picture URL when one loaded.
 */
export function userIdentityOf(snapshot) {
  const signedIn = snapshot?.view?.status === 'credential-stored'
  const profile = signedIn && snapshot?.details?.profile?.status === 'ready' ? snapshot.details.profile.value : undefined
  const name = typeof profile?.name === 'string' && profile.name.trim() !== '' ? profile.name.trim() : undefined
  const picture = signedIn && snapshot?.avatar?.status === 'ready' && typeof snapshot.avatar.url === 'string' && snapshot.avatar.url !== ''
    ? snapshot.avatar.url
    : undefined
  return { name: name ?? t('User'), picture }
}
