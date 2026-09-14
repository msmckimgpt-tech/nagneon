import type {Message} from './types';

export function DonationBadge({donation}:Pick<Message,'donation'>){
  if(!donation)return null;
  return <span className="donation-amount">후원 {donation.amount}P{donation.anonymous?' · 익명':''}</span>;
}
