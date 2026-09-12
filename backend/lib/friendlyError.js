/**
 * Translates raw Postgres/Supabase errors into plain-English messages so
 * internal table/constraint names never reach the UI. Falls back to a
 * generic message for anything not explicitly recognized.
 */

const CONSTRAINT_MESSAGES = {
  orders_nextopper_order_id_key: 'This order has already been received.',
  shipments_order_id_fkey: 'That order no longer exists.',
};

function extractConstraint(message) {
  const match = /constraint "([^"]+)"/.exec(message || '');
  return match ? match[1] : null;
}

/** @param {object} error Supabase/postgrest error object ({ code, message, details }) */
function friendlyDbError(error) {
  if (!error) return 'Something went wrong. Please try again.';

  const constraint = extractConstraint(error.message);
  if (constraint && CONSTRAINT_MESSAGES[constraint]) return CONSTRAINT_MESSAGES[constraint];

  switch (error.code) {
    case '23505': // unique_violation
      return 'That already exists — please check for a duplicate.';
    case '23503': // foreign_key_violation
      return 'That record no longer exists.';
    case '23514': // check_violation
      return 'One of the values entered is not valid.';
    case '22P02': // invalid_text_representation (bad UUID etc.)
      return 'Invalid request.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

module.exports = { friendlyDbError };
