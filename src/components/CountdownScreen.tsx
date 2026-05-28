import React from 'react';

interface Props {
  count: number;
}

export function CountdownScreen({ count }: Props) {
  return (
    <div className="countdown-screen">
      <div className="countdown-label">Get Ready!</div>
      {/* key forces React to remount on each tick → restarts CSS animation */}
      <div className="countdown-number" key={count}>{count}</div>
    </div>
  );
}
