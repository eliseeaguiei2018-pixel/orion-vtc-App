import { StateMachine } from '../../../core/stateMachine.js';

/** États du cycle de vie d'une course VTC (cf. docs/01 §4). */
export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'driver_en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'paid'
  | 'rated'
  | 'cancelled'
  | 'no_driver';

export const rideStateMachine = new StateMachine<RideStatus>(
  {
    searching: ['accepted', 'cancelled', 'no_driver'],
    accepted: ['driver_en_route', 'cancelled'],
    driver_en_route: ['arrived', 'cancelled'],
    arrived: ['in_progress', 'cancelled'],
    in_progress: ['completed'],
    completed: ['paid'],
    paid: ['rated'],
    rated: [],
    cancelled: [],
    no_driver: [],
  },
  'searching',
);
