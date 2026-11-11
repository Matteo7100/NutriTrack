/** DTO del trasporto: rappresentano risultati pubblici, mai repository del backend. */
export interface User { id: string; email: string; name: string; role: 'PATIENT' | 'NUTRITIONIST' }
export interface Food { food: string; quantity: number; unit: string }
export interface Meal { name: string; options: { foods: Food[] }[] }
export interface Content { meals: Meal[] }
export interface Version {
  id: string; mealPlanId: string; patientId: string; versionNumber: number;
  validFrom: number; validUntil: number | null; parentVersionId: string | null;
  content: Content; changeSet: { path: string; before: unknown; after: unknown }[];
}
export interface Entry {
  id: string; patientId: string; operationId: string; consumptionTime: number;
  createdAt: number; actualConsumption: string; mealPlanVersionId: string | null;
}
export type MeasurementType = 'WEIGHT' | 'ARM_CIRCUMFERENCE' | 'TORSO_CIRCUMFERENCE';
export type Measurement = {
  id: string; patientId: string; operationId: string; timestamp: number;
  value: number;
} & ({ type: 'WEIGHT'; unit: 'KG' } | { type: Exclude<MeasurementType, 'WEIGHT'>; unit: 'CM' });
export interface Invitation { id: string; nutritionistName?: string; nutritionistId?: string; status?: string }
export interface Snapshot {
  user: User; active: Version | null; history: Version[]; diary: Entry[];
  measurements: Measurement[]; sharing: boolean; cachedAt: number;
}
