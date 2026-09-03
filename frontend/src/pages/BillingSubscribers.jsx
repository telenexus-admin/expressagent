import React, { useState } from 'react';
import BillingSubscribersLegacy from './BillingSubscribersLegacy';
import PppoeClientCreate from './PppoeClientCreate';
import SubscriberMigrationCenter from './SubscriberMigrationCenter';

export default function BillingSubscribers(props) {
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [pppoeOpen, setPppoeOpen] = useState(false);
  const [legacyKey, setLegacyKey] = useState(0);

  const closePppoe = () => {
    setPppoeOpen(false);
    setLegacyKey((value) => value + 1);
  };

  const interceptSubscriberActions = (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;

    const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
    const heading = button.querySelector?.('b')?.textContent?.trim() || '';

    if (label === 'Import / migrate') {
      event.preventDefault();
      event.stopPropagation();
      setMigrationOpen(true);
      return;
    }

    if (heading === 'PPPoE client' || label.startsWith('PPPoE client')) {
      event.preventDefault();
      event.stopPropagation();
      setPppoeOpen(true);
    }
  };

  return (
    <div className="contents" onClickCapture={interceptSubscriberActions}>
      <BillingSubscribersLegacy key={legacyKey} {...props} />
      {migrationOpen && (
        <SubscriberMigrationCenter
          routers={props.routers || []}
          plans={props.plans || []}
          hotspotPlans={props.hotspotPlans || []}
          reload={props.reload}
          close={() => setMigrationOpen(false)}
        />
      )}
      {pppoeOpen && (
        <PppoeClientCreate
          routers={props.routers || []}
          plans={props.plans || []}
          reload={props.reload}
          close={closePppoe}
        />
      )}
    </div>
  );
}
