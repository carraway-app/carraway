import { affinity } from "./affinity";
import { attio } from "./attio";
import type { CrmProvider } from "./provider";

export const providers: readonly CrmProvider[] = [attio, affinity];
