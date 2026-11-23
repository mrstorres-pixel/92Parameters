import { create } from 'zustand';
import {api,secureBackend} from '../utils/secureApi';

export const useAuthStore = create((set) => ({
  currentStaff: null,
  login: (staff) => set({ currentStaff: staff }),
  logout: async () => {if(secureBackend)await api('session',{method:'DELETE'});set({ currentStaff: null });},
}));
