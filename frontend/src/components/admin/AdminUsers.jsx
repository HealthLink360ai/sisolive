import { useEffect, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';
import AdminUserDetail from './AdminUserDetail.jsx';

/* ============================================================
   ADMIN — USERS
   Ported from index.html (~lines 3752-3807).

   Fixes applied per prior audit:
   - The source table header read "Role" / "Status" but the cells
     underneath actually render department and admin/user account
     type, not a job role or an online/offline status. Relabeled to
     "Department" / "Account type" to match what's actually shown.
   - Rows are now clickable, opening a drill-down (AdminUserDetail)
     with that user's activity via AdminAPI.getUserActivity(user.id).
     This component owns the open/close state internally so it can
     be rendered standalone (e.g. <AdminUsers />) with no extra
     wiring required from the parent AdminScreen.
   ============================================================ */
export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState(null);

  useEffect(() => {
    AdminAPI.getUsers()
      .then(d => { setUsers(Array.isArray(d) ? d : (d.users || [])); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}>Loading users…</div>;
  }

  if (users.length === 0) {
    return (
      <div style={{ padding: 40, color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>
        No users have signed in yet.
      </div>
    );
  }

  return (
    <>
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.users /></span>User <em>activity</em></div>
          <span className="panel-tag">{users.length} USERS</span>
        </div>
        <div className="user-table">
          <div className="user-table-head">
            <span>Person</span><span>Department</span><span>Queries</span><span>Last active</span><span>Account type</span>
          </div>
          {users.map((u) => {
            const initials = (u.name || u.email || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            const identifier = u.id ?? u.email;
            return (
              <div
                key={u.id || u.email}
                className="user-table-row"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedUserId(identifier)}
              >
                <div className="user-cell">
                  <div className="user-av-tbl active">{initials}</div>
                  <div>
                    <div className="user-cell-name">{u.name || u.email}</div>
                    <div className="user-cell-role">{u.role || 'User'}</div>
                  </div>
                </div>
                <span className="user-team">{u.department || u.team || '—'}</span>
                <span className="user-num">{u.queryCount ?? u.query_count ?? '—'}</span>
                <span className="user-last">{u.lastActive || u.last_active || '—'}</span>
                <span className="user-conf">{u.is_admin ? 'Admin' : 'User'}</span>
              </div>
            );
          })}
        </div>
      </div>
      {selectedUserId != null && (
        <AdminUserDetail userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </>
  );
}
