// Keep the baseline through reconnects. Revisions and reopened tickets are not new arrivals.
export function createTicketTracker() {
  let initialized = false;
  const seen = new Set();
  return (tickets) => {
    const arrivals = tickets.filter(
      (ticket) =>
        !seen.has(String(ticket.id)) &&
        ["new", "preparing"].includes(ticket.status),
    );
    tickets.forEach((ticket) => seen.add(String(ticket.id)));
    if (!initialized) {
      initialized = true;
      return [];
    }
    return arrivals;
  };
}

export function playKitchenChime(context) {
  const start = context.currentTime;
  [660, 880].forEach((frequency, index) => {
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + index * 0.18);
    gain.gain.linearRampToValueAtTime(0.22, start + index * 0.18 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + index * 0.18 + 0.3);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + index * 0.18);
    oscillator.stop(start + index * 0.18 + 0.32);
  });
}
