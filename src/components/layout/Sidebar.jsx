import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Warehouse, Leaf, Clock, DollarSign, BarChart3, Receipt, Ban, Menu, ChevronLeft, History, Users } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/pos', icon: ShoppingCart, label: 'Point of Sale' },
  { to: '/products', icon: Package, label: 'Products' },
  { to: '/inventory', icon: Warehouse, label: 'Inventory' },
  { to: '/ingredients', icon: Leaf, label: 'Ingredients' },
  { to: '/time-tracking', icon: Clock, label: 'Time Tracking' },
  { to: '/cash', icon: DollarSign, label: 'Cash Drawer' },
  { to: '/reports', icon: BarChart3, label: 'Reports', ownerOnly: true },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/voids', icon: Ban, label: 'Void Log' },
  { to: '/staff', icon: Users, label: 'Staff Management', ownerOnly: true },
  { to: '/audit', icon: History, label: 'Audit Log', ownerOnly: true },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUiStore();
  const { currentStaff } = useAuthStore();
  const isOwner = currentStaff?.role === 'owner';

  const filteredNav = navItems.filter(item => !item.ownerOnly || isOwner);

  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">92</div>
        <h1>Parameters</h1>
      </div>
      <nav className="sidebar-nav">
        {filteredNav.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <item.icon />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-icon" onClick={toggleSidebar} title={sidebarOpen ? 'Collapse' : 'Expand'}>
          {sidebarOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </aside>
  );
}
