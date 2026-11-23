import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { businessDate } from "../utils/reportDates.js";

// Date choices belong to the report workspace, not to an individual route.
// Store only date controls; records, staff details and review data never persist.
export const useReportPeriod = create(
  persist(
    (set) => ({
      range: "today",
      customStart: "",
      customEnd: businessDate(),
      lookbackAmount: 8,
      lookbackUnit: "months",
      setRange: (range) => set({ range }),
      setStart: (customStart) => set({ customStart }),
      setEnd: (customEnd) => set({ customEnd }),
      setAmount: (lookbackAmount) => set({ lookbackAmount }),
      setUnit: (lookbackUnit) => set({ lookbackUnit }),
      setDates: (customStart, customEnd) =>
        set({ range: "custom", customStart, customEnd }),
    }),
    {
      name: "92parameters-report-period",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({
        range,
        customStart,
        customEnd,
        lookbackAmount,
        lookbackUnit,
      }) => ({ range, customStart, customEnd, lookbackAmount, lookbackUnit }),
    },
  ),
);
