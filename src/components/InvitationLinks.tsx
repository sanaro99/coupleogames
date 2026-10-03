import { useState } from 'react';
import { Link } from 'lucide-react';
import { invitationLink, type SeatInvitations } from '../../shared/invitations';

export function InvitationLinks({ invitations, onError }: { invitations: SeatInvitations; onError: (message: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, label: string) => {
    try { await navigator.clipboard.writeText(invitationLink(location.origin, key)); setCopied(label); }
    catch { onError('Select the link and copy it manually.'); }
  };
  return <div className="invitation-links">
    <p>Send your partner their invitation. Keep your return link to come back to your seat.</p>
    <label htmlFor="partner-invitation">Partner invitation link</label>
    <input id="partner-invitation" readOnly value={invitationLink(location.origin, invitations.partnerKey)} onFocus={e => e.target.select()} />
    <button className="secondary" onClick={() => void copy(invitations.partnerKey, 'partner')}><Link size={16} />{copied === 'partner' ? 'Copied' : 'Copy partner link'}</button>
    <details><summary>Invitation code</summary><input aria-label="Partner invitation code" readOnly value={invitations.partnerKey} onFocus={e => e.target.select()} /></details>
    <label htmlFor="return-invitation">Your return link</label>
    <input id="return-invitation" readOnly value={invitationLink(location.origin, invitations.creatorKey)} onFocus={e => e.target.select()} />
    <button className="secondary" onClick={() => void copy(invitations.creatorKey, 'creator')}><Link size={16} />{copied === 'creator' ? 'Copied' : 'Copy return link'}</button>
    <small>Each link opens one player’s seat. Share only the partner link with your partner.</small>
  </div>;
}
