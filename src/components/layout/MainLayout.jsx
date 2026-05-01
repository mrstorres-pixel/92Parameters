import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuthStore } from '../../stores/authStore';
import { navItems } from '../../config/navigation';

export default function MainLayout() {
  const { currentStaff } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const role = currentStaff?.role || 'cashier';

  useEffect(() => {
    // Find the current nav item based on the path
    const currentNavItem = navItems.find(item => item.to === location.pathname);
    
    // If the item exists and the user's role is not allowed, redirect to Dashboard
    if (currentNavItem && !currentNavItem.roles.includes(role)) {
      navigate('/');
    }
  }, [location.pathname, role, navigate]);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        <Header />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
