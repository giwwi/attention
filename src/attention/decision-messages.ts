import type {
  AttentionSessionDescriptor,
  MaterialDecision,
  PageCapture,
} from '../shared/types';

export const ATTENTION_MATERIAL_DECIDE_TYPE = 'ATTENTION_MATERIAL/DECIDE';

export interface AttentionMaterialDecideMessage {
  type: typeof ATTENTION_MATERIAL_DECIDE_TYPE;
  capture: PageCapture;
  decision: MaterialDecision;
}

export interface AttentionMaterialDecideResponse {
  ok: boolean;
  session?: AttentionSessionDescriptor;
}
