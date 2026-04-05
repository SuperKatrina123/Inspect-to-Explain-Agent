import { Order } from '../data/mockData';

interface Props { order: Order }

export function OrderSummary({ order }: Props) {
  // Derived fields: calculated at render time from API data
  const subtotal = order.items.reduce((s, item) => s + item.price * item.quantity, 0);
  const total = subtotal + order.shipping - order.discount;

  return (
    <div className="order-summary">
      {/* Static text: section heading */}
      <h2 className="order-title">Order Summary</h2>
      {/* API response: order ID from mock data */}
      <div className="order-id">#{order.id}</div>

      {/* Static text: column headers */}
      <div className="order-items-header">
        <span>Item</span><span>Qty</span><span>Price</span>
      </div>

      {/* API response: items rendered from array */}
      <div className="order-items">
        {order.items.map((item) => (
          <div key={item.id} className="order-item-row">
            <span className="item-name">{item.name}</span>
            <span className="item-qty">×{item.quantity}</span>
            <span className="item-price">${item.price.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="price-breakdown">
        <div className="price-row">
          {/* Static label */}
          <span className="price-label">Subtotal</span>
          {/* Derived: sum of items */}
          <span className="subtotal-value">${subtotal.toFixed(2)}</span>
        </div>

        <div className="price-row">
          <span className="price-label">Shipping</span>
          <span className="shipping-value">${order.shipping.toFixed(2)}</span>
        </div>

        {/* Conditional rendering: discount row shown only if discount > 0 */}
        {order.discount > 0 && (
          <div className="price-row discount-row">
            <span className="price-label">Discount</span>
            <span className="discount-value">−${order.discount.toFixed(2)}</span>
          </div>
        )}

        <div className="price-row total-row">
          {/* Static label */}
          <span className="price-label total-label">Total</span>
          {/* Derived: computed from subtotal + shipping - discount */}
          <span className="total-value">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
