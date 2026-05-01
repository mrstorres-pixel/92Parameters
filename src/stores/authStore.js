import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  currentStaff: null,
  login: (staff) => set({ currentStaff: staff }),
  logout: () => set({ currentStaff: null }),
}));
