import { create } from 'zustand';

export const useUiStore = create((set) => ({
  sidebarOpen: true,
  mobileMenuOpen: false,
  activeModal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleMobileMenu: () => set((s) => ({ mobileMenuOpen: !s.mobileMenuOpen })),
  closeMobileMenu: () => set({ mobileMenuOpen: false }),
  openModal: (name, data) => set({ activeModal: { name, data } }),
  closeModal: () => set({ activeModal: null }),
}));
