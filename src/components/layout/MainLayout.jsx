import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { navItems } from '../../config/navigation';

export default function MainLayout() {
  const { currentStaff } = useAuthStore();
  const { mobileMenuOpen, closeMobileMenu } = useUiStore();
  const location = useLocation();
  const navigate = useNavigate();
  const role = currentStaff?.role || 'cashier';
  const allowed=navItems.find(item=>item.to===location.pathname);

  useEffect(() => {
    // Close mobile menu on route change
    closeMobileMenu();

    // Find the current nav item based on the path
    const currentNavItem = navItems.find(item => item.to === location.pathname);
    
    // If the item exists and the user's role is not allowed, redirect to Dashboard
    if (currentNavItem && !currentNavItem.roles.includes(role)) {
      navigate(role==='kitchen'?'/kitchen':'/');
    }
  }, [location.pathname, role, navigate]);

  if(role==='kitchen'&&location.pathname!=='/kitchen')return <Navigate to="/kitchen" replace/>;
  if(allowed&&!allowed.roles.includes(role))return <Navigate to={role==='kitchen'?'/kitchen':'/'} replace/>;
  return (
    <div className="app-layout">
      <div className={`sidebar-overlay ${mobileMenuOpen ? 'active' : ''}`} onClick={closeMobileMenu} />
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
