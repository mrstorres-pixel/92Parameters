import { LayoutDashboard, ShoppingCart, Package, Warehouse, Leaf, Clock, DollarSign, BarChart3, Receipt, Ban, History, Users, ShieldCheck } from 'lucide-react';

export const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['cashier', 'manager', 'owner'] },
  { to: '/pos', icon: ShoppingCart, label: 'Point of Sale', roles: ['cashier', 'manager', 'owner'] },
  { to: '/products', icon: Package, label: 'Products', roles: ['cashier', 'manager', 'owner'] },
  { to: '/inventory', icon: Warehouse, label: 'Inventory', roles: ['owner'] },
  { to: '/ingredients', icon: Leaf, label: 'Ingredients', roles: ['owner'] },
  { to: '/time-tracking', icon: Clock, label: 'Time Tracking', roles: ['cashier', 'manager', 'owner'] },
  { to: '/cash', icon: DollarSign, label: 'Cash Drawer', roles: ['cashier', 'manager', 'owner'] },
  { to: '/reports', icon: BarChart3, label: 'Reports', roles: ['owner'] },
  { to: '/transactions', icon: Receipt, label: 'Transactions', roles: ['cashier', 'manager', 'owner'] },
  { to: '/voids', icon: Ban, label: 'Void Log', roles: ['manager', 'owner'] },
  { to: '/staff', icon: Users, label: 'Staff Management', roles: ['owner'] },
  { to: '/audit', icon: History, label: 'Audit Log', roles: ['owner'] },
  { to: '/maintenance', icon: ShieldCheck, label: 'Maintenance', roles: ['owner'] },
];
