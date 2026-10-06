const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const utils = require('../src/profile-utils.js');

function functionSource(file, name, next) {
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('native select skips empty placeholders and prioritizes exact matches', () => {
  const ctx = {
    normalizeText: x => String(x).trim(),
    normalizeChoiceLabel: x => String(x).trim(),
    choiceTextMatches: (a,b) => !!a && !!b && (a.includes(b) || b.includes(a)),
    setNativeValue: (el,v) => { el.value=v; },
    resolveRankChoiceTarget: (t) => t
  };
  vm.createContext(ctx);
  vm.runInContext(functionSource('../src/content.js','setSelectValue','setContentEditableValue'),ctx);
  const el={value:'old',options:[
    {value:'',textContent:''}, {value:'grad',textContent:'研究生'},
    {value:'master',textContent:'硕士研究生'}, {value:'no',textContent:'否',disabled:true}
  ]};
  assert.equal(ctx.setSelectValue(el,'硕士研究生'),true);
  assert.equal(el.value,'master');
  assert.equal(ctx.setSelectValue(el,'没有此选项'),false);
  assert.equal(el.value,'master','unmatched choices must not clear existing values');
  assert.equal(ctx.setSelectValue(el,'否'),false);
  assert.equal(ctx.setSelectValue(el,''),false);
});

test('native select maps a true rank to the conservative page bucket', () => {
  const ctx = {
    globalThis: { Form2OfferFillRules: require('../src/fill-rules.js') },
    normalizeText: x => String(x).trim(),
    normalizeChoiceLabel: x => String(x).trim(),
    choiceTextMatches: (a,b) => !!a && !!b && a === b,
    setNativeValue: (el,v) => { el.value=v; }
  };
  vm.createContext(ctx);
  vm.runInContext(functionSource('../src/content.js','resolveRankChoiceTarget','choiceTextMatches'),ctx);
  vm.runInContext(functionSource('../src/content.js','setSelectValue','setContentEditableValue'),ctx);
  const el={value:'',options:[
    {value:'',textContent:'请选择'}, {value:'1',textContent:'前5%'},
    {value:'2',textContent:'前20%'}, {value:'3',textContent:'前50%'}, {value:'4',textContent:'其他'}
  ]};
  assert.equal(ctx.setSelectValue(el,'前10%','专业排名'),true);
  assert.equal(el.value,'2');
  assert.equal(ctx.setSelectValue(el,'前30%','成绩排名'),true);
  assert.equal(el.value,'3');
  assert.equal(ctx.resolveRankChoiceTarget('10%', ['前5%','前20%'], '持股比例'), '10%');
});

test('profile editor retains partial dates, ongoing periods and custom select values', () => {
  assert.equal(utils.getProfileInputType('month','2025'),'text');
  assert.equal(utils.getProfileInputType('month','至今'),'text');
  assert.equal(utils.getProfileInputType('month','2025-09'),'month');
  assert.equal(utils.getProfileInputType('month','2025-13'),'text');
  assert.deepEqual(utils.getProfileSelectOptions(['','学士','硕士'],'金融硕士'),['','学士','硕士','金融硕士']);
  assert.deepEqual(utils.getProfileSelectOptions(['','学士'],'学士'),['','学士']);
});

test('standard autocomplete metadata resolves unlabeled fields without guessing passwords', () => {
  assert.equal(utils.getAutocompleteFieldLabel('section-applicant shipping given-name'),'名');
  assert.equal(utils.getAutocompleteFieldLabel('email'),'邮箱');
  assert.equal(utils.getAutocompleteFieldLabel('tel-national'),'电话');
  assert.equal(utils.getAutocompleteFieldLabel('new-password'),'');
  assert.equal(utils.getAutocompleteFieldLabel('one-time-code'),'');
});

function manualFillHarness({ risk = 'standard', confirmed = true, field = {}, target = {} } = {}) {
  const calls = { writes:0, confirms:0, messages:[] };
  const control = { isConnected:true, maxLength:-1, getAttribute:()=>'', ...target };
  const ctx = {
    focusedPageControl:control, autofillInProgress:false, manualFillInProgress:false,
    isVisible:()=>true,
    buildFieldMeta:()=>({label:'姓名',type:'text',hasCurrentValue:false,...field}),
    inferMatchSection:()=>'', guessAutofillValueFieldType:()=> 'text',
    Form2OfferSafetyPolicy:{classifyCandidate:()=>({risk})},
    window:{confirm:()=>{calls.confirms++;return confirmed;}},
    valuesLookEquivalent:(a,b)=>a===b,
    fillElementSmart:async(el,value)=>{calls.writes++;el.value=value;return {ok:true};},
    markElement:()=>{}, setProfilePanelStatus:(message)=>calls.messages.push(message)
  };
  vm.createContext(ctx);
  vm.runInContext('async '+functionSource('../src/content.js','fillProfileItemIntoFocusedField','syncProfilePanelHostState'),ctx);
  return {ctx,calls,control,run:()=>ctx.fillProfileItemIntoFocusedField({label:'姓名',value:'测试同学'},'基本信息')};
}

test('click-to-fill only writes the remembered field on an explicit action', async () => {
  const h=manualFillHarness();
  assert.equal(h.calls.writes,0);
  await h.run();
  assert.equal(h.calls.writes,1);
  assert.equal(h.control.value,'测试同学');
  assert.equal(h.ctx.manualFillInProgress,false);
});

test('focusing sidebar search does not replace the remembered page field', () => {
  class Control {
    constructor(own=false) { this.own=own; }
    closest() { return this.own; }
    matches() { return true; }
  }
  const document={addEventListener:()=>{}};
  const ctx={Element:Control,document,PANEL_ID:'panel',FLOAT_ID:'float',CONTROL_SELECTOR:'input',
    focusedPageControl:null,profilePanel:null,buildFieldMeta:()=>({label:'姓名'})};
  vm.createContext(ctx);
  const source=functionSource('../src/content.js','rememberFocusedPageControl','fillProfileItemIntoFocusedField');
  vm.runInContext(source.replace(/async\s*$/,''),ctx);
  const page=new Control();
  ctx.rememberFocusedPageControl({target:page});
  ctx.rememberFocusedPageControl({target:new Control(true)});
  assert.equal(ctx.focusedPageControl,page);
});

test('manual filling requires separate sensitive and overwrite confirmations', async () => {
  for (const scenario of [ {risk:'sensitive'}, {risk:'declaration'}, {field:{hasCurrentValue:true,currentValue:'旧值'}} ]) {
    const h=manualFillHarness({...scenario,confirmed:false});
    await h.run();
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.confirms,1);
  }
});

test('manual filling blocks upload, captcha, password, stale fields and overlong text', async () => {
  for (const scenario of [
    {risk:'blocked'}, {field:{type:'password'}}, {field:{label:'短信验证码'}},
    {target:{getAttribute:()=> 'one-time-code'}}, {target:{isConnected:false}},
    {target:{maxLength:2}}, {field:{readOnly:true}}, {field:{disabled:true}}
  ]) {
    const h=manualFillHarness(scenario);
    await h.run();
    assert.equal(h.calls.writes,0);
  }
});

test('settings renderer includes helpers and preserves nonstandard date/select values', () => {
  const html=fs.readFileSync(require.resolve('../src/options.html'),'utf8');
  assert.ok(html.indexOf('profile-utils.js') < html.indexOf('options.js'));
  const ctx={Form2OfferProfileUtils:utils,escapeHtml:x=>String(x)};
  vm.createContext(ctx);
  vm.runInContext(functionSource('../src/options.js','renderStructuredField','renderStructuredCustomArea'),ctx);
  assert.match(ctx.renderStructuredField({label:'开始时间',key:'start',type:'month'},'2025'),/type="text" value="2025"/);
  assert.match(ctx.renderStructuredField({label:'学位',key:'degree',type:'select',options:['','硕士']},'金融硕士'),/value="金融硕士" selected/);
});
