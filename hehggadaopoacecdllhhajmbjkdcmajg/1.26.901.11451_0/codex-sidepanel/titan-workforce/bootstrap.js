import {createWorkforceState} from "./state.js";
import {migrateWorkforceState} from "./migrations.js";
import {TitanWorkforceController} from "./controller.js";
import {TitanMissionControl} from "./mission-control.js";
import {TitanExecutionServices} from "./execution-services.js";
import {TitanWorkforceIntegration} from "./integration.js";
import {installLegacyNativeBridge,installConversationServices} from "./native-bridge.js";
import {createConversationService} from "./conversation-service.js";
import {TitanWorkforceControls} from "./controls.js";
import {TitanMergeController} from "./merge-controller.js";
import {installEngineeringCockpit} from "./cockpit.js";

const KEY="titanDeveloperWorkforceV4";
async function load(){
 const LEGACY_KEY="titan5x5.state.v2";
 const stored=await chrome.storage.local.get([KEY,LEGACY_KEY]);
 const state=stored[KEY]?migrateWorkforceState(stored[KEY]):migrateWorkforceState(stored[LEGACY_KEY]||createWorkforceState());
 const audit=(type,data={})=>window.dispatchEvent(new CustomEvent("titan-workforce:audit",{detail:{type,data,at:Date.now()}}));
 const services=new TitanExecutionServices();
 const missions=new TitanMissionControl(state);
 const controller=new TitanWorkforceController(state,{audit,services,missionControl:missions});
 installLegacyNativeBridge(services,audit);
 const conversations=createConversationService();installConversationServices(services,{chat:conversations,work:conversations},audit);
 const integration=new TitanWorkforceIntegration({state,controller,missionControl:missions,services,audit});
 integration.bindGlobals();
 const controls=new TitanWorkforceControls(controller,audit);const mergeController=new TitanMergeController({audit});
 const api={state,controller,missions,services,integration,controls,mergeController,save:()=>chrome.storage.local.set({[KEY]:state})};
 globalThis.TitanDeveloperWorkforce=api;
 installEngineeringCockpit(api);
 await api.save();
 window.dispatchEvent(new CustomEvent("titan-workforce:ready",{detail:{schemaVersion:state.schemaVersion,readiness:integration.readiness()}}));
 return api;
}
load().catch(error=>{console.error("[Titan Workforce] bootstrap failed",error);window.dispatchEvent(new CustomEvent("titan-workforce:error",{detail:{message:String(error?.message||error)}}))});
