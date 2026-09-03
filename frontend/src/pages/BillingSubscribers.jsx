import React, { useState } from 'react';
import BillingSubscribersLegacy from './BillingSubscribersLegacy';
import SubscriberMigrationCenter from './SubscriberMigrationCenter';

export default function BillingSubscribers(props) {
  const [migrationOpen, setMigrationOpen] = useState(false);

  const interceptMigrationButton = (event) => {
    const button = event.target.closest?.('button');
    if (!button || button.textContent?.trim() !== 'Import / migrate') return;
    event.preventDefault();
    event.stopPropagation();
    setMigrationOpen(true);
  };

  return (
    <div className="contents" onClickCapture={interceptMigrationButton}>
      <BillingSubscribersLegacy {...props} />
      {migrationOpen && (
        <SubscriberMigrationCenter
          routers={props.routers || []}
          plans={props.plans || []}
          hotspotPlans={props.hotspotPlans || []}
          reload={props.reload}
          close={() => setMigrationOpen(false)}
        />
      )}
    </div>
  );
}
