//Imports
import {SlashCommandBuilder, ContextMenuCommandBuilder} from '@discordjs/builders';
import {ApplicationCommandType} from 'discord.js'
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import config from './config.json' assert {type:'json'};

//Set up rest request
const rest = new REST({ version: '10' }).setToken(config.key.token);

//Command descriptors
const commands =
[
	//Command: list
	new SlashCommandBuilder().setName('list')
		.setDescription('Display all currently tracked shows')
		.addStringOption(option =>
		option.setName('type')
			.setDescription('What list should display')
			.setRequired(false)
			.addChoices(
				{ name: 'Current Shows', value: 'current' },
				{ name: 'Finished Shows', value: 'finished' },
				{ name: 'Dropped Shows', value: 'dropped' },
				{ name: 'Maybe Shows', value: 'maybe' },
				{ name: 'Watched Movies', value: 'movies' },
				{ name: 'Suggestions', value: 'suggestions' },
			)),
	
	//Command: next
	new SlashCommandBuilder().setName('next')
		.setDescription('Set the next episode of a show as watched')
		.addStringOption(option =>
		option.setName('show')
			.setDescription('The show ID to watch')
			.setRequired(true)),
	
	//Command: who
	new SlashCommandBuilder().setName('who')
		.setDescription('Get details on someone')
		.addUserOption(option =>
		option.setName('user')
			.setDescription('The person to query')
			.setRequired(true)),
			
	//Command: reset
	new SlashCommandBuilder().setName('reset')
		.setDescription('Reset someone\'s counter')
		.addUserOption(option =>
		option.setName('user')
			.setDescription('The person to reset')
			.setRequired(true)),
	
	//Command: weedgen
	new SlashCommandBuilder().setName('weedgen')
		.setDescription('Generate ironic weed name'),
	
	//Command: justWatched
	new SlashCommandBuilder().setName('justwatched')
		.setDescription('Display a comment button for a movie')
		.addIntegerOption(option =>
			option.setName('movie')
				.setDescription('ID of the movie to comment on')
				.setRequired(false)),
	
	//Command: password
	new SlashCommandBuilder().setName('password')
		.setDescription('Change your password for ziqh.co.uk/weeaboo')
		.addStringOption(option =>
			option.setName('password')
				.setDescription('Your new password')
				.setRequired(true)),
	
	//Command: show
	new SlashCommandBuilder().setName('show')
		.setDescription('Various show operations')
		.addSubcommand(subcommand =>
			subcommand.setName('last')
			.setDescription('Set last watched episode')
			.addStringOption(option =>
				option.setName('showid')
				.setDescription('The show ID to update')
				.setRequired(true))
			.addIntegerOption(option =>
				option.setName('lastep')
				.setDescription('Last episode number watched')
				.setRequired(true))
		)
		.addSubcommand(subcommand =>
			subcommand.setName('status')
			.setDescription('Update the status of a show')
			.addStringOption(option =>
				option.setName('showid')
				.setDescription('The show ID to update')
				.setRequired(true))
			.addStringOption(option =>
				option.setName('setstatus')
				.setDescription('The status to set')
				.setRequired(true)
				.addChoices(
					{ name: 'Watching', value: 'watching' },
					{ name: 'Finished', value: 'finished' },
					{ name: 'Dropped', value: 'dropped' }
				)
			)
		).addSubcommand(subcommand =>
			subcommand.setName('rate')
			.setDescription('Rate a show')
			.addStringOption(option =>
				option.setName('showid')
				.setDescription('The show ID to rate')
				.setRequired(true))
		)
		.addSubcommand(subcommand =>
			subcommand.setName('info')
			.setDescription('Get episode info on a show')
			.addStringOption(option =>
				option.setName('showid')
				.setDescription('The show ID to query')
				.setRequired(true))
			.addIntegerOption(option =>
				option.setName('episode')
				.setDescription('The episode number')
				.setRequired(false))
		),
		
	//Command: movie
	new SlashCommandBuilder().setName('movie')
		.setDescription('Various movie operations')
		.addSubcommand(subcommand =>
			subcommand.setName('rate')
			.setDescription('Rate a movie')
			.addIntegerOption(option =>
				option.setName('movieid')
				.setDescription('The movie ID to rate')
				.setRequired(false))
		),
	
	//Command: personality
	new SlashCommandBuilder().setName('personality')
		.setDescription('Change auto-weeaboo personality module')
		.addStringOption(option =>
				option.setName('setting')
				.setDescription('Personality to apply')
				.setRequired(true)
				.addChoices(
					{ name: 'Sassy', value: 'sassy' },
					{ name: 'Kind', value: 'kind' },
					{ name: 'Mean', value: 'mean' },
					{ name: 'Shy', value: 'shy' },
					{ name: 'Stronk', value: 'stronk' },
					{ name: 'Flirty', value: 'flirty' },
					{ name: 'Off', value: 'dumb' },
				)
		),
	
	//Command: which
	new SlashCommandBuilder().setName('which')
		.setDescription('Ask Auto-Weeaboo what anime to watch next'),
		
	//Command: opinion
	new SlashCommandBuilder().setName('opinion')
		.setDescription('Ask Auto-Weeaboo her opinion on a show, movie, or user')
		.addStringOption(option =>
			option.setName('showid')
			.setDescription('The show ID')
			.setRequired(false)
		)
		.addIntegerOption(option =>
			option.setName('movieid')
			.setDescription('The movie number')
			.setRequired(false)
		)
		.addUserOption(option =>
			option.setName('userid')
			.setDescription('The user')
			.setRequired(false)
		),
		
	//Command: weebimg
	new SlashCommandBuilder().setName('weebimg')
		.setDescription('Generate a weeb image')
		.addStringOption(option =>
			option.setName('prompt')
			.setDescription('What you want a weeb image of')
			.setRequired(true)
		),

	//Context: enhance
	new ContextMenuCommandBuilder().setName('Enhance')
		.setType(ApplicationCommandType.Message),
	
	//Context: delete
	new ContextMenuCommandBuilder().setName('Delete this')
	.setType(ApplicationCommandType.Message)
]
.map(command => command.toJSON());

//Register commands with The Shed
rest.put(Routes.applicationGuildCommands(config.key.client, config.guild.shed), { body: commands })
	.then(() => console.log('Commands registered with The Shed'))
	.catch(console.error);

//Register commands with LLLDMZ
rest.put(Routes.applicationGuildCommands(config.key.client, config.guild.dmz), { body: commands })
	.then(() => console.log('Commands registered with LLLDMZ'))
	.catch(console.error);