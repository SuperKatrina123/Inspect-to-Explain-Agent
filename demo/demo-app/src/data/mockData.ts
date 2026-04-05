export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarInitials: string;
  memberSince: string;
  level: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  isVip: boolean;
  points: number;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  shipping: number;
  discount: number;
}

// API-response style: data that would come from a backend in production
export const mockUser: UserProfile = {
  id: 'user-001',
  name: 'Alice Chen',
  email: 'alice.chen@example.com',
  avatarInitials: 'AC',
  memberSince: '2021-03-15',
  level: 'Gold',
  isVip: true,
  points: 4820,
};

export const mockOrder: Order = {
  id: 'ORD-2024-8812',
  items: [
    { id: 'item-1', name: 'Wireless Headphones', quantity: 1, price: 299.99 },
    { id: 'item-2', name: 'USB-C Cable (3-pack)', quantity: 2, price: 24.99 },
    { id: 'item-3', name: 'Phone Case', quantity: 1, price: 39.99 },
  ],
  shipping: 12.99,
  discount: 30.0,
};
