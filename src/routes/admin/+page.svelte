<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'admin.title')}</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

{#if form?.recoveryUrl}
	<div class="alert alert-success mb-2" role="alert">
		{t(data.locale, 'admin.recovered', { name: form.recoveredName })}
	</div>
	<!-- Readonly input rather than a <code> block, matching the login link on
	     /profile: it is the one thing on this page that has to be selected and
	     copied, often on a phone. -->
	<input class="input input-bordered min-h-11 mb-6 w-full" readonly value={form.recoveryUrl} />
{/if}

<h2 class="mb-1 text-lg font-semibold">{t(data.locale, 'admin.members')}</h2>
<p class="mb-3 text-sm">{t(data.locale, 'admin.recover_hint')}</p>

<!-- One form around the whole table. Each row's submit button carries the
     account it acts on as name/value, which is plain HTML and needs no
     JavaScript and no password field per row. -->
<form method="POST" action="?/recover" class="flex flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'admin.recover_password')}</span>
		<!-- No minlength: an account may predate a bound change, and a client-side
		     rule that disagrees with the server only ever locks someone out. -->
		<input
			name="currentPassword"
			type="password"
			required
			autocomplete="current-password"
			class="input input-bordered min-h-11"
		/>
	</label>

	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th>{t(data.locale, 'auth.username')}</th>
					<th>{t(data.locale, 'auth.display_name')}</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.members as member (member.id)}
					<tr>
						<td>{member.username}</td>
						<td>{member.displayName}</td>
						<td>
							<button
								class="btn btn-secondary min-h-11"
								name="userId"
								value={member.id}
								aria-label={`${t(data.locale, 'admin.recover')} — ${member.username}`}
							>
								{t(data.locale, 'admin.recover')}
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</form>
