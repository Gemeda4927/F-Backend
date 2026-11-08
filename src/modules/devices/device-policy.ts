export function activeDeviceLimit() {
  const limit = Number(process.env.MAX_ACTIVE_STUDENT_DEVICES ?? '1');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5)
    throw new Error(
      'MAX_ACTIVE_STUDENT_DEVICES must be an integer from 1 to 5',
    );
  return limit;
}
