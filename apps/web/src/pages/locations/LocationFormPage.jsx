import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useZodForm } from '@/lib/forms/useZodForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field, FormErrorSummary } from '@/components/form/field';
import { FormPage, SectionCard } from '@/components/patterns/page';
import { ClassificationField } from '@/components/reference/ClassificationPicker';
import { LocationSelector } from '@/components/location/LocationSelector';
import { institutions } from '../organization/resources';
import { locations } from '../assets/resources';

/**
 * Location create — `07-ui.md` §5.3, `IMPLEMENTATION_PLAN.md` §18.5;
 * REQ-LOC-001/008.
 *
 * The classification must be a leaf here too (REQ-LOC-008, `BR-011`), which is
 * why the same picker is used as on the asset form rather than a second control.
 *
 * A parent makes this location physically inside another. The server rejects a
 * self-reference and a cycle (`BR-012`); the picker below simply offers the
 * existing locations.
 */

const locationSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(255),
  classificationId: z.string().trim().length(12, 'select a classification'),
  parentLocationId: z.string().optional(),
  institutionId: z.string().optional(),
});

export function LocationFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = locations.useCreate();
  const [classification, setClassification] = useState(null);

  // No `parents` list any more: the parent is chosen through the hierarchical
  // picker, which drills the tree instead of flattening the first hundred
  // locations into a dropdown that could not show where any of them sat.
  const institutionList = institutions.useList({ pageSize: 100, status: 'active' });

  const { form, submit } = useZodForm({
    schema: locationSchema,
    defaultValues: { name: '', classificationId: '', parentLocationId: '', institutionId: '' },
    onSubmit: async (values) => {
      const saved = await create.mutateAsync({
        ...values,
        parentLocationId: values.parentLocationId || undefined,
        institutionId: values.institutionId || undefined,
      });
      navigate(`/locations/${saved.id}`);
    },
  });

  const {
    register,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <FormPage
      title={t('locations.new')}
      description={t('locations.formDescription')}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => navigate('/locations')}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('locations.create')}
          </Button>
        </>
      }
    >
      <SectionCard title={t('locations.details')}>
        <div className="space-y-4">
          <FormErrorSummary error={errors.root?.server} />

          <Field label={t('common.fields.name')} error={errors.name?.message} required>
            {(fieldProps) => <Input {...fieldProps} {...register('name')} />}
          </Field>

          <Field
            label={t('common.fields.classification')}
            error={errors.classificationId?.message}
            /* The requirement id that used to be in this hint is gone: it is an
               engineering reference, not something a school administrator
               should be reading. */
            hint={t('locations.classificationHint')}
            required
          >
            {(fieldProps) => (
              <ClassificationField
                id={fieldProps.id}
                invalid={fieldProps.invalid}
                value={classification}
                onChange={(node) => {
                  setClassification(node);
                  setValue('classificationId', node?.id ?? '', { shouldValidate: true });
                }}
              />
            )}
          </Field>

          {/*
            The parent, chosen by drilling the hierarchy rather than from a flat
            list. A dropdown of the first hundred locations could not say where
            any of them sat — two rooms called "Lab 2" were indistinguishable —
            and it silently omitted everything past the page cap.
          */}
          <Field
            label={t('locations.columns.inside')}
            error={errors.parentLocationId?.message}
            hint={t('locations.parentHint')}
          >
            {({ invalid, id }) => (
              <LocationSelector
                id={id}
                invalid={invalid}
                allowClear
                value={watch('parentLocationId') || null}
                onChange={(next) => setValue('parentLocationId', next ?? '', { shouldDirty: true })}
                placeholder={t('locations.topLevel')}
              />
            )}
          </Field>

          <Field label={t('common.fields.institution')} error={errors.institutionId?.message}>
            {({ invalid, id, ...describedBy }) => (
              // The shared Select, not a raw `<select>`: the old one received
              // `invalid` as a prop and React warned about it reaching the DOM.
              <Select
                value={watch('institutionId') || 'default'}
                onValueChange={(next) =>
                  setValue('institutionId', next === 'default' ? '' : next, { shouldDirty: true })
                }
              >
                <SelectTrigger id={id} invalid={invalid} {...describedBy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('locations.institutionDefault')}</SelectItem>
                  {(institutionList.data?.data ?? []).map((institution) => (
                    <SelectItem key={institution.id} value={institution.id}>
                      {institution.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      </SectionCard>
    </FormPage>
  );
}

export { locationSchema };
