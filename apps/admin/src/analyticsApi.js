import { api } from './apiClient.js';

export function getAnalyticsOverview() {
  return api.get('/admin/analytics/overview');
}
