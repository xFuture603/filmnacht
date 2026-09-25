<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<PageHeader title={t(data.locale, 'admin.title')} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

{#if form?.recoveryUrl}
	<div class="alert alert-success alert-soft mb-2" role="alert">
		{t(data.locale, 'admin.recovered', { name: form.recoveredName })}
	</div>
	<!-- Readonly input rather than a <code> block, matching the login link on
	     /profile: it is the one thing on this page that has to be selected and
	     copied, often on a phone. -->
	<input class="input mb-6 min-h-11 w-full font-mono text-sm" readonly value={form.recoveryUrl} />
{/if}

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'admin.members')}</h2>
		<p class="text-sm text-base-content/70">{t(data.locale, 'admin.recover_hint')}</p>

		<!-- One form around the whole list. Each row's submit button carries the
		     account it acts on as name/value, which is plain HTML and needs no
		     JavaScript and no password field per row. -->
		<form method="POST" action="?/recover" class="flex flex-col gap-3">
			<Field label={t(data.locale, 'admin.recover_password')}>
				<!-- No minlength: an account may predate a bound change, and a client-side
				     rule that disagrees with the server only ever locks someone out. -->
				<input
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					class="input min-h-11 w-full"
				/>
			</Field>

			<ul class="divide-y divide-base-300">
				{#each data.members as member (member.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-3">
						<div class="min-w-0">
							<div class="break-words">{member.displayName}</div>
							<div class="font-mono text-xs text-base-content/70">{member.username}</div>
						</div>
						<button
							class="btn btn-outline btn-sm min-h-11"
							name="userId"
							value={member.id}
							aria-label={`${t(data.locale, 'admin.recover')} — ${member.username}`}
						>
							{t(data.locale, 'admin.recover')}
						</button>
					</li>
				{/each}
			</ul>
		</form>
	</div>
</section>
