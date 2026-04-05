export interface Benefit {
  id: string;
  icon: string;
  title: string;
  description: string;
  isPremium: boolean;
}

// Config-driven: these come from a static config, not an API.
// In production this could be a feature-flag system or CMS.
export const BENEFITS_CONFIG: Benefit[] = [
  {
    id: 'benefit-free-shipping',
    icon: '🚚',
    title: 'Free Shipping',
    description: 'On all orders over $50',
    isPremium: false,
  },
  {
    id: 'benefit-early-access',
    icon: '⚡',
    title: 'Early Access',
    description: 'Shop new arrivals 24 h before everyone else',
    isPremium: true,
  },
  {
    id: 'benefit-cashback',
    icon: '💰',
    title: '5% Cashback',
    description: 'Earn points on every purchase',
    isPremium: true,
  },
  {
    id: 'benefit-support',
    icon: '🎧',
    title: 'Priority Support',
    description: '24/7 dedicated customer service',
    isPremium: false,
  },
];
