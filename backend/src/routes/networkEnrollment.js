const express=require('express');
const {authMiddleware,scopeMiddleware}=require('../middleware/auth');
const {approveProvisioningPlan,collectRouterFingerprint,createProvisioningPlan,enrollmentFeatureState,getEnrollment,listEnrollments}=require('../services/networkEnrollment');
const {executeProvisioningPlan,provisioningFeatureState}=require('../services/routerProvisioningExecutor');
const router=express.Router();
router.use(authMiddleware,scopeMiddleware);
function tenant(req,res){if(req.scope.isSuperadmin&&!req.scope.clientId){res.status(400).json({error:'clientId query parameter is required for superadmin'});return null}return req.scope.clientId}
function admin(req,res){if(!['admin','superadmin'].includes(req.user?.role)){res.status(403).json({error:'Administrator permission is required'});return false}return true}
router.get('/enrollment/state',(req,res)=>{if(!tenant(req,res))return;res.json({...enrollmentFeatureState(),provisioning:provisioningFeatureState()})});
router.get('/enrollments',async(req,res)=>{const c=tenant(req,res);if(!c)return;try{res.json({enrollments:await listEnrollments(c),...enrollmentFeatureState()})}catch(e){res.status(500).json({error:'Failed to load router enrollments'})}});
router.get('/enrollments/:id',async(req,res)=>{const c=tenant(req,res);if(!c)return;try{const x=await getEnrollment(c,req.params.id);if(!x)return res.status(404).json({error:'Router enrollment not found'});res.json(x)}catch(e){res.status(400).json({error:e.message})}});
router.post('/enrollments/:id/discover',async(req,res)=>{const c=tenant(req,res);if(!c||!admin(req,res))return;try{const x=await getEnrollment(c,req.params.id);if(!x?.router_id)return res.status(400).json({error:'Router bootstrap has not connected'});res.json(await collectRouterFingerprint(c,req.params.id,x.router_id))}catch(e){res.status(400).json({error:e.message||'Router discovery failed'})}});
router.post('/enrollments/:id/plans',async(req,res)=>{const c=tenant(req,res);if(!c||!admin(req,res))return;try{res.status(201).json(await createProvisioningPlan(c,req.params.id,req.body||{},req.user.id))}catch(e){res.status(400).json({error:e.message||'Could not create provisioning plan'})}});
router.post('/enrollments/:id/plans/:planId/approve',async(req,res)=>{const c=tenant(req,res);if(!c||!admin(req,res))return;try{res.json(await approveProvisioningPlan(c,req.params.id,req.params.planId,req.user.id))}catch(e){res.status(400).json({error:e.message||'Could not approve provisioning plan'})}});
router.post('/enrollments/:id/plans/:planId/execute',async(req,res)=>{const c=tenant(req,res);if(!c||!admin(req,res))return;try{res.json(await executeProvisioningPlan(c,req.params.id,req.params.planId,req.body||{},{adminId:req.user.id}))}catch(e){res.status(400).json({error:e.message||'Could not execute provisioning plan',run_id:e.run_id||null,status:e.status||null,rollback:e.rollback||null})}});
module.exports=router;
