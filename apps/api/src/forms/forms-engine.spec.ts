import { FieldType, SubmissionStatus } from '@prisma/client';
import {
  EngineFormDefinition,
  EngineFormField,
  EngineFormSubmission,
  EngineStepForm,
  FieldReference,
  FormsEngineError,
  allowedOptionValues,
  planApprove,
  planReject,
  planSubmit,
  requiredFormsSatisfied,
  resolveReferences,
  toPrefillData,
  unmetRequiredForms,
  validateFieldValues,
  validateFormDefinition,
} from './forms-engine';

const baseFields: EngineFormField[] = [
  { order: 1, key: 'amount', label: '金額', fieldType: FieldType.NUMBER, required: true },
  {
    order: 2,
    key: 'mode',
    label: '模式',
    fieldType: FieldType.SELECT,
    required: true,
    options: [
      { value: 'PURCHASE', label: '買斷' },
      { value: 'SUBSCRIPTION', label: '訂閱' },
    ],
  },
  { order: 3, key: 'note', label: '備註', fieldType: FieldType.TEXTAREA, required: false },
];

const quoteForm: EngineFormDefinition = {
  id: 'f-quote',
  code: 'QUOTE',
  name: '報價單',
  isSignable: true,
  fields: baseFields,
};

describe('validateFormDefinition', () => {
  it('accepts a valid definition', () => {
    expect(validateFormDefinition(baseFields)).toEqual([]);
  });

  it('detects duplicate field keys', () => {
    expect(
      validateFormDefinition([baseFields[0], { ...baseFields[0], order: 9 }]),
    ).toContain('duplicate_field_key');
  });

  it('detects duplicate field orders', () => {
    expect(
      validateFormDefinition([baseFields[0], { ...baseFields[1], order: 1 }]),
    ).toContain('duplicate_field_order');
  });

  it('requires options for SELECT/MULTISELECT', () => {
    expect(
      validateFormDefinition([
        { order: 1, key: 's', label: 's', fieldType: FieldType.SELECT, required: true },
      ]),
    ).toContain('missing_select_options');
  });
});

describe('allowedOptionValues', () => {
  it('reads string options', () => {
    expect(allowedOptionValues(['A', 'B'])).toEqual(['A', 'B']);
  });
  it('reads {value} options', () => {
    expect(allowedOptionValues([{ value: 'X' }, { value: 'Y' }])).toEqual(['X', 'Y']);
  });
});

describe('validateFieldValues', () => {
  it('flags missing required fields', () => {
    const errs = validateFieldValues(baseFields, { mode: 'PURCHASE' });
    expect(errs).toContainEqual({ key: 'amount', code: 'required' });
  });

  it('accepts numeric strings for NUMBER', () => {
    expect(validateFieldValues(baseFields, { amount: '1200', mode: 'PURCHASE' })).toEqual([]);
  });

  it('rejects non-numeric NUMBER', () => {
    expect(
      validateFieldValues(baseFields, { amount: 'abc', mode: 'PURCHASE' }),
    ).toContainEqual({ key: 'amount', code: 'not_a_number' });
  });

  it('rejects SELECT value outside options', () => {
    expect(
      validateFieldValues(baseFields, { amount: 1, mode: 'NOPE' }),
    ).toContainEqual({ key: 'mode', code: 'not_in_options' });
  });

  it('validates MULTISELECT membership and shape', () => {
    const fields: EngineFormField[] = [
      { order: 1, key: 'tags', label: 't', fieldType: FieldType.MULTISELECT, required: true, options: ['a', 'b'] },
    ];
    expect(validateFieldValues(fields, { tags: ['a', 'b'] })).toEqual([]);
    expect(validateFieldValues(fields, { tags: ['a', 'z'] })).toContainEqual({
      key: 'tags',
      code: 'option_not_allowed',
    });
    expect(validateFieldValues(fields, { tags: 'a' })).toContainEqual({
      key: 'tags',
      code: 'not_a_list',
    });
  });

  it('validates DATE and CHECKBOX', () => {
    const fields: EngineFormField[] = [
      { order: 1, key: 'd', label: 'd', fieldType: FieldType.DATE, required: true },
      { order: 2, key: 'c', label: 'c', fieldType: FieldType.CHECKBOX, required: true },
    ];
    expect(validateFieldValues(fields, { d: '2026-06-06', c: true })).toEqual([]);
    expect(validateFieldValues(fields, { d: 'nope', c: 'yes' })).toEqual([
      { key: 'd', code: 'invalid_date' },
      { key: 'c', code: 'not_a_boolean' },
    ]);
  });
});

describe('planSubmit', () => {
  it('produces a SUBMITTED plan with submitter/time', () => {
    const plan = planSubmit(quoteForm, { amount: 1200, mode: 'PURCHASE' }, 'u-sales');
    expect(plan.status).toBe(SubmissionStatus.SUBMITTED);
    expect(plan.submittedById).toBe('u-sales');
    expect(plan.submittedAt).toBeInstanceOf(Date);
  });

  it('throws validation_failed with field errors', () => {
    expect.assertions(2);
    try {
      planSubmit(quoteForm, {}, 'u');
    } catch (e) {
      expect((e as FormsEngineError).code).toBe('validation_failed');
      expect((e as FormsEngineError).fieldErrors?.length).toBeGreaterThan(0);
    }
  });
});

describe('signing (approve/reject)', () => {
  const submission: EngineFormSubmission = {
    id: 's1',
    formDefinitionId: 'f-quote',
    stepInstanceId: 'si1',
    status: SubmissionStatus.SUBMITTED,
    data: {},
  };

  it('records approver and time on approve', () => {
    const plan = planApprove(quoteForm, submission, 'u-mgr');
    expect(plan.status).toBe(SubmissionStatus.APPROVED);
    expect(plan.approvedById).toBe('u-mgr');
    expect(plan.approvedAt).toBeInstanceOf(Date);
  });

  it('records rejecter on reject', () => {
    expect(planReject(quoteForm, submission, 'u-mgr').status).toBe(SubmissionStatus.REJECTED);
  });

  it('refuses approval on non-signable form', () => {
    const f = { ...quoteForm, isSignable: false };
    expect(() => planApprove(f, submission, 'u')).toThrow(/form_not_signable/);
  });

  it('refuses to re-finalize', () => {
    expect(() =>
      planApprove(quoteForm, { ...submission, status: SubmissionStatus.APPROVED }, 'u'),
    ).toThrow(/already_finalized/);
  });

  it('refuses approval before submission', () => {
    expect(() =>
      planApprove(quoteForm, { ...submission, status: SubmissionStatus.DRAFT }, 'u'),
    ).toThrow(/submission_not_submitted/);
  });

  it('refuses mismatched form', () => {
    expect(() =>
      planApprove(quoteForm, { ...submission, formDefinitionId: 'other' }, 'u'),
    ).toThrow(/form_mismatch/);
  });
});

describe('required forms gate', () => {
  const stepForms: EngineStepForm[] = [
    { stepId: 'step1', formId: 'f-quote', isRequired: true },
    { stepId: 'step1', formId: 'f-opt', isRequired: false },
  ];
  const signable = new Set(['f-quote']);

  it('is unmet without a submission', () => {
    expect(unmetRequiredForms(stepForms, [], 'step1', 'si1', signable)).toContain('f-quote');
  });

  it('signable form needs APPROVED (SUBMITTED is not enough)', () => {
    const subs: EngineFormSubmission[] = [
      { id: 's', formDefinitionId: 'f-quote', stepInstanceId: 'si1', status: SubmissionStatus.SUBMITTED, data: {} },
    ];
    expect(requiredFormsSatisfied(stepForms, subs, 'step1', 'si1', signable)).toBe(false);
    const approved: EngineFormSubmission[] = [
      { id: 's', formDefinitionId: 'f-quote', stepInstanceId: 'si1', status: SubmissionStatus.APPROVED, data: {} },
    ];
    expect(requiredFormsSatisfied(stepForms, approved, 'step1', 'si1', signable)).toBe(true);
  });

  it('non-signable form is met when SUBMITTED', () => {
    const sf: EngineStepForm[] = [{ stepId: 'st', formId: 'f-a', isRequired: true }];
    const subs: EngineFormSubmission[] = [
      { id: 's', formDefinitionId: 'f-a', stepInstanceId: 'si9', status: SubmissionStatus.SUBMITTED, data: {} },
    ];
    expect(requiredFormsSatisfied(sf, subs, 'st', 'si9', new Set())).toBe(true);
  });
});

describe('cross-step references (bring prior outputs forward)', () => {
  const prior: EngineFormSubmission[] = [
    { id: 'sub-quote', formDefinitionId: 'f-quote', stepInstanceId: 'si1', stepOrder: 1, status: SubmissionStatus.APPROVED, data: { amount: 1200, mode: 'PURCHASE' } },
    { id: 'sub-req', formDefinitionId: 'f-req', stepInstanceId: 'si2', stepOrder: 2, status: SubmissionStatus.SUBMITTED, data: { scope: '客製A' } },
    { id: 'sub-old', formDefinitionId: 'f-quote', stepInstanceId: 'si0', stepOrder: 0, status: SubmissionStatus.APPROVED, data: { amount: 999 } },
  ];
  const refs: FieldReference[] = [
    { sourceFormId: 'f-quote', sourceKey: 'amount', targetKey: 'contractAmount' },
    { sourceFormId: 'f-req', sourceKey: 'scope', targetKey: 'workScope' },
    { sourceFormId: 'f-missing', sourceKey: 'x', targetKey: 'y' },
  ];

  it('brings the latest prior output forward', () => {
    const resolved = resolveReferences(refs, prior, 5);
    const prefill = toPrefillData(resolved);
    expect(prefill.contractAmount).toBe(1200);
    expect(prefill.workScope).toBe('客製A');
    expect('y' in prefill).toBe(false);
    expect(resolved.find((r) => r.targetKey === 'contractAmount')?.sourceSubmissionId).toBe('sub-quote');
  });

  it('only considers submissions from earlier steps', () => {
    const resolved = resolveReferences(refs, prior, 1);
    expect(toPrefillData(resolved).contractAmount).toBe(999);
  });
});
