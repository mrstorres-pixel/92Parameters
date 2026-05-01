import { create } from 'zustand';

export const useUiStore = create((set) => ({
  sidebarOpen: true,
  activeModal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openModal: (name, data) => set({ activeModal: { name, data } }),
  closeModal: () => set({ activeModal: null }),
}));
