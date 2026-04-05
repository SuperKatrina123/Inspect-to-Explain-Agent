import { UserProfile } from '../data/mockData';

interface Props { user: UserProfile }

export function UserProfileCard({ user }: Props) {
  return (
    <div className="user-profile-card">
      {/* Static text: section heading */}
      <h2 className="profile-title">User Profile</h2>

      <div className="profile-body">
        {/* API response: avatar initials derived from name */}
        <div className="profile-avatar" aria-label={user.name}>
          {user.avatarInitials}
        </div>

        <div className="profile-info">
          {/* API response: name from mock user data */}
          <div className="profile-name">{user.name}</div>
          {/* API response: email from mock user data */}
          <div className="profile-email">{user.email}</div>

          <div className="profile-meta">
            {/* Static label + API response value */}
            <span className="meta-label">Member since</span>
            <span className="profile-join-date">{user.memberSince}</span>
          </div>

          <div className="profile-meta">
            {/* Static label */}
            <span className="meta-label">Level</span>
            {/* API response: tier badge */}
            <span className={`level-badge level-${user.level.toLowerCase()}`}>
              {user.level}
            </span>
          </div>

          <div className="profile-meta">
            {/* Static label */}
            <span className="meta-label">Points</span>
            {/* Derived field: formatted from numeric API value */}
            <span className="points-value">{user.points.toLocaleString()} pts</span>
          </div>

          {/* Conditional rendering: only shown when isVip === true */}
          {user.isVip && (
            <div className="vip-badge">⭐ VIP Member</div>
          )}
        </div>
      </div>
    </div>
  );
}
