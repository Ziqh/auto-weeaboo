// -----------------------------
//  AUTO-WEEABOO
//  "It's an automatic system!"
// -----------------------------

//Imports
import config from './config.json' assert {type:'json'};
import prompts from './prompts.json' assert {type:'json'};
import {
	Client,
	GatewayIntentBits,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActivityType
	} from 'discord.js';
import Database from 'better-sqlite3'
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import express from 'express';
import {Configuration, OpenAIApi} from 'openai';

//Local DB config
const db = new Database(config.db.watchtrack, {readonly:false, fileMustExist:true});
const flexdb = new Database(config.db.flexget, {readonly:true, fileMustExist:true});

//Discord Setup
const client = new Client({intents: [GatewayIntentBits.Guilds,	GatewayIntentBits.GuildMessages]});

//Express setup
const websrv = express();

//OpenAI setup
const configuration = new Configuration({
  apiKey: config.key.openai,
});
const openai = new OpenAIApi(configuration);
const aiModel = 'text-davinci-002';

//Access levels
const Access = {
	readonly: 1,
	comment: 2,
	edit: 3,
	admin: 4
}

//Some generic response strings
const say_unknownRequester = "Sorry, don't know you";
const say_unknownUser = "Sorry, don't know them";
const say_unknownShow = "Sorry, couldn't find that show";
const say_unknownMovie = "Sorry, couldn't find that movie";
const say_noAccess = "Sorry, that's illegal";

//Startup AI setting (sassy, kind, mean, shy, stronk, flirty, dumb)
let ai_setting = 'sassy';

//On successful startup...
client.on('ready', () =>
{
	//Report status
	console.log('Ready, running in the following servers:');
	client.guilds.cache.forEach(guild =>
	{
		console.log('[' + guild.id + '] '+ guild.name);
	})
	
	//Start up the web server
	websrv.listen(3000,() =>
	{
		console.log('Web server started on port 3000');
	})

	//Clear activity
	client.user.setPresence({ activities: null });
});

//Primary method for all interaction commands
client.on('interactionCreate', async interaction =>
{
	//Slash command handlers
	if (interaction.isCommand())
	{
		//Command: List (list all shows)
		if (interaction.commandName == 'list')
		{
			//Get list type
			let listType;
			if(interaction.options.get('type') == null) listType = 'current';
			else listType = interaction.options.get('type').value;
			
			//Complex list for current shows
			if(listType == 'current')
			{
				//Set up lists for shows ready-to-watch, shows with no available episodes, and not-flexget shows
				let readyShows = [];
				let watchedShows = [];
				let otherShows = [];
				
				//Grab all shows currently set as "watching"
				const rows = db.prepare('SELECT shortName, fullName, lastWatched, watchedToday, flexget, epsAvailable FROM shows WHERE status=?').all('watching');
				rows.forEach(show =>
				{
					//Figure out available episodes; flexget preferred, epsAvailable if not
					let epsAvail = 0;
					if (show.flexget != '')
						epsAvail = flexdb.prepare('SELECT MAX(number) as lastep FROM series_episodes WHERE series_id=?').get(show.flexget).lastep;
					else if (show.epsAvailable > 0)
						epsAvail = show.epsAvailable;
					
					//Figure out how many episodes are ready to watch
					let epsToWatch = 0;
					if (epsAvail > 0)
						epsToWatch = epsAvail - show.lastWatched;
					
					//Pop the show into the relevant list
					let deets = {shortName: show.shortName, fullName: show.fullName, lastWatched: show.lastWatched, watchedToday: show.watchedToday, epsAvail: epsAvail, epsToWatch: epsToWatch};
					if (show.flexget == '')
						otherShows.push(deets);
					else if(epsToWatch > 0)
						readyShows.push(deets);
					else
						watchedShows.push(deets);
				});
				
				//Start building the string to send
				let	sendString = 'List of tracked shows:\n```cs\n'
				
				//Tracked shows with unwatched episodes
				sendString += 'Ready to watch:\n'
				for (const show of readyShows)
					sendString += printShow(show);
				
				//Tracked shows with no unwatched episodes
				sendString += 'Up to date:\n'
				for (const show of watchedShows)
					sendString += printShow(show);
				
				//Shows that are not on flexget
				sendString += 'Other shows:\n'
				for (const show of otherShows)
					sendString += printShow(show);
				
				//Close out and send string as reply
				sendString += '```';
				await interaction.reply(sendString);
			}
			else if(listType=='finished' || listType=='dropped')
			{
				//Start building the string to send
				let	sendString = 'List of ' + listType + ' shows:\n```cs\n'
				
				//Grab all shows that match filter
				const rows = db.prepare('SELECT shortName, fullName, lastWatched, watchedToday, flexget, epsAvailable FROM shows WHERE status=?').all(listType);
				rows.forEach(show =>
				{
					sendString += printShow(show);
				});
				
				//Close out and send string as reply
				sendString += '```';
				await interaction.reply(sendString);
			}
			else if(listType=='movies')
			{
				//Start building the string to send
				let	sendString = 'List of last 20 watched movies:\n```cs\n'
				
				//Grab last 20 watched movies
				const rows = db.prepare('SELECT id, name, watchDate FROM movies WHERE watchDate > \'01/01/2000\' ORDER BY id DESC LIMIT 20').all();
				rows.forEach(movie =>
				{
					sendString += printMovie(movie);
				});
				
				//Close out and send string as reply
				sendString += '```';
				await interaction.reply(sendString);
			}
			else if(listType=='suggestions')
			{
				//Start building the string to send
				let	sendString = 'List of active suggestions:\n```cs\n'
				
				//Grab all suggestions
				const rows = db.prepare('SELECT id, user, date, suggestion FROM suggestions').all();
				rows.forEach(sug =>
				{
					sendString += printSuggestion(sug);
				});
				
				//Close out and send string as reply
				sendString += '```';
				await interaction.reply(sendString);
			}
		}
		
		//Command: Next (advance watched episode of a show)
		else if(interaction.commandName == 'next')
		{
			//Verify the requester exists
			if(typeof getUserDetails(interaction.user.id) == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			
			//Get show details
			let show = getShowDetails(interaction.options.get('show').value);
			
			//Verify the show exists
			if(typeof show == 'undefined')
			{
				await interaction.reply({ content: say_unknownShow, ephemeral: true });
				return;
			}

			//Increment the lastWatched of the relevant show
			const nextEp = show.lastWatched + 1;
			db.prepare('UPDATE shows SET lastWatched=?, watchedToday=1 WHERE shortName=?').run(nextEp, show.shortName);
			
			//Alert the user on success
			await interaction.reply('Set the last watched episode for ' + show.shortName + ' to ' + nextEp);
		}
		
		//Command: Who (give details on a user)
		else if (interaction.commandName == 'who')
		{
			//Get target user details
			let user = getUserDetails(interaction.options.get('user').value);
			
			//Verify the target user exists
			if(typeof user == 'undefined')
			{
				await interaction.reply({ content: say_unknownUser, ephemeral: true });
				return;
			}
			
			//Build up the info string
			let sendString = 'That\'s ' + user.name;

			//Give counter info where available
			if (user.counterText != '')
			{
				//Discord code block start
				sendString += '```';
				
				//Javascript date calculation is absolute trash
				const lastDate = Date.parse(user.counterDate);
				const today = new Date();
				const days = Math.round((today - lastDate) / (1000*60*60*24));
			
				//I'm sure there's a nicer way to do this but whatever
				if (days == 1) sendString += '\n1 day has ';
				else sendString += '\n' + days + ' days have ';
				
				sendString +=  'passed since ' + user.name + ' ' + user.counterText;
				
				//Discord code block end
				sendString += '```';
			}
			
			await interaction.reply(sendString);
		}
		
		//Command: Reset (reset a user counter)
		else if (interaction.commandName == 'reset')
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			//Verify requester has at least Commenter(1) access
			else if (requester.access < Access.comment)
			{
				await interaction.reply({ content: say_noAccess, ephemeral: true });
				return;
			}
			
			//Verify the target user exists and get details
			let user = getUserDetails(interaction.options.get('user').value);
			if(typeof user == 'undefined')
			{
				await interaction.reply({ content: say_unknownUser, ephemeral: true });
				return;
			}
			
			//Still hate javascript date calculation
			const lastDate = Date.parse(user.counterDate);
			const today = new Date();
			const days = Math.round((today - lastDate) / (1000*60*60*24));
			const todayString = today.toISOString().substring(0, 10);
			
			//Update the DB and respond to the user (update the high score if they beat it)
			if(days > user.highScore)
			{
				db.prepare('UPDATE people SET counterDate=?, highScore=? WHERE id=?').run(todayString, days, user.id);
				await interaction.reply("I've reset the counter for " + user.name + "```\n0 days have passed since " + user.name + " " + user.counterText + "\n(Previously " + days + ", a new personal best!)```")
			}
			else
			{
				db.prepare('UPDATE people SET counterDate=? WHERE id=?').run(todayString, user.id);
				await interaction.reply("I've reset the counter for " + user.name + "```\n0 days have passed since " + user.name + " " + user.counterText + "\n(Previously " + days + ")```")
			}
		}
	
		//Command: WeedGen (Generate haha funny weed name)
		else if (interaction.commandName == 'weedgen')
		{
			//Get random values for each part
			let intro = db.prepare('SELECT text FROM weedGen WHERE type=1 ORDER BY RANDOM() LIMIT 1').get().text;
			let prefix = db.prepare('SELECT text FROM weedGen WHERE type=2 ORDER BY RANDOM() LIMIT 1').get().text;
			let suffix = db.prepare('SELECT text FROM weedGen WHERE type=3 ORDER BY RANDOM() LIMIT 1').get().text;
			
			//Add an 's' sometimes
			if (suffix.slice(-1) != 's' && Math.random() > 0.8)
				suffix += 's';
			
			//Provide the comedy
			await interaction.reply(intro + ' **' + prefix + ' ' + suffix + '**');
			
			if(ai_setting != 'dumb')
			{
				const completion = await openai.createCompletion({
				model: aiModel,
					max_tokens: 50,
					temperature: 1,
					prompt: 'Answer is one adjective and one bizzare noun. Only generate two words. Answer:'
				});
				await interaction.editReply(intro + ' **' + prefix + ' ' + suffix + '**\nI just call it ' + completion.data.choices[0].text.replace(/(\r\n|\n|\r)/gm, ""));
			}
		}

		//Command: justwatched (Provide a comment button for a just-watched movie
		else if (interaction.commandName == 'justwatched')
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			//Verify requester has at least Admin(4) access
			else if (requester.access < Access.admin)
			{
				await interaction.reply({ content: say_noAccess, ephemeral: true });
				return;
			}
			
			//If movie ID provided, get details for it - otherwise use the most recent movie
			let movie;
			let movieID = interaction.options.getInteger('movie');
			if(Number.isInteger(movieID))
				movie = db.prepare('SELECT id,name FROM movies WHERE id=?').get(movieID);
			else
				movie = db.prepare('SELECT id,name FROM movies ORDER BY watchDate DESC LIMIT 1').get();
			
			//Check we got a valid movie
			if(typeof movie == 'undefined')
			{
				await interaction.reply({ content: say_unknownMovie, ephemeral: true });
				return;
			}
			
			//Create a button for commenting on the target movie
			const commentButton = new ButtonBuilder()
				.setCustomId('click_moviecomment' + movie.id)
				.setLabel('Rate this movie')
				.setStyle(ButtonStyle.Primary)
			const row1 = new ActionRowBuilder().addComponents(commentButton);
			
			//Send the reply
			await interaction.reply({ content: 'We just watched ' + movie.name + '!', components: [row1] });
			
		}
		
		//Command: Password (Set user password)
		else if (interaction.commandName == 'password')
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			
			//Validate provided password
			const newPass = interaction.options.get('password').value;
			if(newPass.length < 4 || newPass.length > 20)
			{
				await interaction.reply({ content: 'Very strict password requirements: between 4 and 20 characters, please', ephemeral: true });
				return;
			}
			
			//Generate a password hash
			const hashPass = bcrypt.hashSync(newPass, 10);
			
			//Update the db and advise user
			db.prepare('UPDATE people SET password=? WHERE id=?').run(hashPass, requester.id);
			await interaction.reply({ content: 'Your password has been updated', ephemeral: true });
		}
		
		//Command: Show (master command for show-related operations)
		else if (interaction.commandName == 'show')
		{
			//Get a valid show, regardless of subcommand
			let show = getShowDetails(interaction.options.get('showid').value);
			if(typeof show == 'undefined')
			{
				await interaction.reply({ content: say_unknownShow, ephemeral: true });
				return;
			}
			
			//Subcommand: Last (set last watched episode)
			if (interaction.options.getSubcommand() == 'last')
			{
			}
			
			//Subcommand: Status (set show status)
			else if (interaction.options.getSubcommand() == 'status')
			{
				//Verify the requester exists
				let requester = getUserDetails(interaction.user.id);
				if(typeof requester == 'undefined')
				{
					await interaction.reply({ content: say_unknownRequester, ephemeral: true });
					return;
				}
				//Verify requester has at least Edit(3) access
				else if (requester.access < Access.edit)
				{
					await interaction.reply({ content: say_noAccess, ephemeral: true });
					return;
				}
				
				//Create a button for commenting
					const commentButton = new ButtonBuilder()
						.setCustomId('click_showend' + show.shortName)
						.setLabel('Add a comment')
						.setStyle(ButtonStyle.Primary)
					const row1 = new ActionRowBuilder().addComponents(commentButton);
				
				//Get set status
				let setStatus = interaction.options.get('setstatus').value;
				
				//If finished...
				if(setStatus == 'finished')
				{
					//Mark the show as finished in the database
					db.prepare('UPDATE shows SET status=\'finished\' WHERE shortName=?').run(show.shortName);
					
					//Send the message
					await interaction.reply({ content: 'Congratulations! ' + show.fullName + ' is now **finished**!', components: [row1] });
				}
				//If dropped
				else if(setStatus == 'dropped')
				{
					//Mark the show as dropped in the database
					db.prepare('UPDATE shows SET status=\'dropped\' WHERE shortName=?').run(show.shortName);
					
					//Send the message
					await interaction.reply({ content: 'Oh no! ' + show.fullName + ' is now **dropped**!', components: [row1] });
				}
				//If watching
				else if(setStatus == 'watching')
				{
					//Mark the show as dropped in the database
					db.prepare('UPDATE shows SET status=\'dropped\' WHERE shortName=?').run(show.shortName);
					
					//Send the message
					await interaction.reply({ content: 'Neat! ' + show.fullName + ' is now **watching**!', components: [row1] });
				}
			}
			
			//Subcommand: Rate (rate a show)
			else if (interaction.options.getSubcommand() == 'rate')
			{
				//Create the form itself
				const showRateForm = new ModalBuilder()
					.setCustomId('form_rateshow' + show.shortName)
					.setTitle('Auto-Weeaboo Show Rating')
				
				//Comment
				const rateComment = new TextInputBuilder()
					.setCustomId('rateComment')
					.setRequired(true)
					.setLabel('What did you think?')
					.setStyle(TextInputStyle.Paragraph);
				const row1 = new ActionRowBuilder().addComponents(rateComment);
				
				//Rating
				const rateOverall = new TextInputBuilder()
					.setCustomId('rateOverall')
					.setRequired(true)
					.setLabel('Your rating from 1 to 10')
					.setStyle(TextInputStyle.Short);
				const row2 = new ActionRowBuilder().addComponents(rateOverall);

				//Add rows to the form
				showRateForm.addComponents(row1, row2);
				
				//Present to the user
				await interaction.showModal(showRateForm);
			}
			
			//Subcommand: Info (get episode info for a show)
			else if (interaction.options.getSubcommand() == 'info')
			{
				//Verify the show has a TVDB entry
				if(show.tvdb < 1)
				{
					await interaction.reply({ content: 'Sorry, that show has no TVDB ID stored', ephemeral: true });
					return;
				}

				//If episode number provided, use it; otherwise use current episode + 1
				let epNo = interaction.options.getInteger('episode');
				if(!Number.isInteger(epNo)) epNo = show.lastWatched + 1;
				
				//If currentSeason populated, use it; otherwise assume 1 (did I ever use this to begin with?)
				let seNo = 1;
				if(Number.isInteger(show.currentSeason)) seNo = show.currentSeason;
				
				//Grab the episode data (use await to make all the async stuff behave like regular-ass sync calls)
				let requestUrl = 'https://api.thetvdb.com/series/' + show.tvdb + '/episodes/query?airedSeason=' + seNo + '&airedEpisode=' + epNo;
				let result = await fetch(requestUrl, { method: "Get" });
				let json = await result.json();
				let epData = json['data'][0];
				
				//Build an embed
				const epDataEmbed = new EmbedBuilder()
					.setColor(0x0099FF)
					.setAuthor({name:show.shortName + ' episode ' + epNo})
					.setTitle(epData['episodeName'])
					.setDescription(epData['overview'])
					.setImage('https://artworks.thetvdb.com/banners/' + epData['filename'])
				
				//Send it
				await interaction.reply({embeds: [epDataEmbed]});
			}
		}
		
		//Command: Movie (master command for movie-related operations)
		else if (interaction.commandName == 'movie')
		{
			//If movie ID provided, get details for it - otherwise use the most recent movie
			let movie;
			let movieID = interaction.options.getInteger('movieid');
			if(Number.isInteger(movieID))
				movie = db.prepare('SELECT id,name FROM movies WHERE id=?').get(movieID);
			else
				movie = db.prepare('SELECT id,name FROM movies ORDER BY watchDate DESC LIMIT 1').get();
			
			//Check we got a valid movie
			if(typeof movie == 'undefined')
			{
				await interaction.reply({ content: say_unknownMovie, ephemeral: true });
				return;
			}
			
			//Subcommand: Rate (rate a movie)
			if (interaction.options.getSubcommand() == 'rate')
			{
				//Verify the requester exists
				let requester = getUserDetails(interaction.user.id);
				if(typeof requester == 'undefined')
				{
					await interaction.reply({ content: say_unknownRequester, ephemeral: true });
					return;
				}
				//Verify requester has at least Commenter(1) access
				else if (requester.access < Access.comment)
				{
					await interaction.reply({ content: say_noAccess, ephemeral: true });
					return;
				}
				
				//Create the form itself
				const movieRateForm = new ModalBuilder()
					.setCustomId('form_ratemovie'+ movie.id)
					.setTitle('Auto-Weeaboo Movie Rating')
				
				//Comment
				const rateComment = new TextInputBuilder()
					.setCustomId('rateComment')
					.setRequired(true)
					.setLabel('What did you think?')
					.setStyle(TextInputStyle.Paragraph);
				const row1 = new ActionRowBuilder().addComponents(rateComment);
				
				//Rating
				const rateOverall = new TextInputBuilder()
					.setCustomId('rateOverall')
					.setRequired(true)
					.setLabel('Your overall rating from 1 to 10')
					.setStyle(TextInputStyle.Short);
				const row2 = new ActionRowBuilder().addComponents(rateOverall);
				
				//GoodBad
				const rateGoodBad = new TextInputBuilder()
					.setCustomId('rateGoodBad')
					.setRequired(false)
					.setLabel('Goodness rating from -5 to 5')
					.setStyle(TextInputStyle.Short);
				const row3 = new ActionRowBuilder().addComponents(rateGoodBad);
				
				//FunBoring
				const rateFunBoring = new TextInputBuilder()
					.setCustomId('rateFunBoring')
					.setRequired(false)
					.setLabel('Fun rating from -5 to 5')
					.setStyle(TextInputStyle.Short);
				const row4 = new ActionRowBuilder().addComponents(rateFunBoring);
				
				//DryHorny
				const rateDryHorny= new TextInputBuilder()
					.setCustomId('rateDryHorny')
					.setRequired(false)
					.setLabel('Horny rating from -5 to 5')
					.setStyle(TextInputStyle.Short);
				const row5 = new ActionRowBuilder().addComponents(rateDryHorny);
				
				//Add rows to the form
				movieRateForm.addComponents(row1, row2, row3, row4, row5);
				
				//Present to the user
				await interaction.showModal(movieRateForm);
			}
		}
		
		//Command: Personality (toggle ai functions)
		else if (interaction.commandName == 'personality')
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			//Verify requester has at least Admin(4) access
			else if (requester.access < Access.admin)
			{
				await interaction.reply({ content: say_noAccess, ephemeral: true });
				return;
			}
			
			
			//Get requested personality type
			ai_setting = interaction.options.get('setting').value;

			//Disable higher brain functions
			if(ai_setting == 'dumb')
			{
				await interaction.reply('Brain returning to power-saving mode...');
			}
			//Recalibrate and give a wake-up message
			else
			{
				await interaction.reply('Personality matrix recalibrating...');
				const completion = await openai.createCompletion({
				model: aiModel,
					max_tokens: 120,
					frequency_penalty: 0.4,
					stop: 'Chat:',
					prompt: getPromptPrefix() + prompts.change
				});
				await interaction.editReply(completion.data.choices[0].text.trim().replace(/(\r\n|\n|\r)/gm, ""));
			}
		}
		
		//Command: Which (suggest which episode to watch next)
		else if (interaction.commandName == 'which')
		{
			//No AI = no suggestion
			if(ai_setting == 'dumb')
			{
				await interaction.reply({ content: 'Sorry, my brain is on power-saving mode', ephemeral: true });
				return;
			}
			
			//Set up show list
			let showString = '';
			
			//Figure out which shows could reasonably be watched next, pop into a list
			const rows = db.prepare('SELECT fullName, lastWatched, flexget, epsAvailable FROM shows WHERE status=?').all('watching');
			let firstLine = true;
			rows.forEach(show =>
			{
				//Figure out available episodes; flexget preferred, epsAvailable if not
				let epsAvail = 0;
				if (show.flexget != '')
					epsAvail = flexdb.prepare('SELECT MAX(number) as lastep FROM series_episodes WHERE series_id=?').get(show.flexget).lastep;
				else if (show.epsAvailable > 0)
					epsAvail = show.epsAvailable;
				
				//Figure out how many episodes are ready to watch
				let epsToWatch = 0;
				if (epsAvail > 0)
					epsToWatch = epsAvail - show.lastWatched;
				
				//Pop the show into the relevant list
				if (epsToWatch > 0 && show.flexget != '')
				{
					if (firstLine)
					{
						showString += show.fullName;
						firstLine = false;
					}
					else
						showString += ', ' + show.fullName;
				}
			});
			//If no shows "Ready to watch", then try again for the "Other shows"
			rows.forEach(show =>
			{
				//Figure out available episodes; flexget preferred, epsAvailable if not
				let epsAvail = 0;
				if (show.flexget != '')
					epsAvail = flexdb.prepare('SELECT MAX(number) as lastep FROM series_episodes WHERE series_id=?').get(show.flexget).lastep;
				else if (show.epsAvailable > 0)
					epsAvail = show.epsAvailable;
				
				//Figure out how many episodes are ready to watch
				let epsToWatch = 0;
				if (epsAvail > 0)
					epsToWatch = epsAvail - show.lastWatched;
				
				//Pop the show into the relevant list
				if (epsToWatch > 0)
				{
					if (firstLine)
					{
						showString += show.fullName;
						firstLine = false;
					}
					else
						showString += ', ' + show.fullName;
				}
			});
			
			//Finish the prompt and submit
			await interaction.deferReply();
			const completion = await openai.createCompletion({
				model: aiModel,
					max_tokens: 150,
					frequency_penalty: 0.4,
					stop: 'Chat:',
					prompt: getPromptPrefix() + prompts.suggest.replace('<shows>', showString)
				});
			await interaction.editReply(completion.data.choices[0].text.trim().replace(/(\r\n|\n|\r)/gm, ""));
		}
		
		//Command: Opinion (get Auto-Weeaboo's thoughts on something)
		else if (interaction.commandName == 'opinion')
		{
			//No AI = no suggestion
			if(ai_setting == 'dumb')
			{
				await interaction.reply({ content: 'Sorry, my brain is on power-saving mode', ephemeral: true });
				return;
			}

			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			
			//User provided a show
			if (interaction.options.get('showid') != null)
			{
				//Check we got a valid show
				let show = getShowDetails(interaction.options.get('showid').value);
				if(typeof show == 'undefined')
				{
					await interaction.reply({ content: say_unknownShow, ephemeral: true });
					return;
				}
				
				//Create the prompt and submit
				await interaction.reply('> ' + requester.name + ': What do you think of ' + show.fullName + '?');
				const completion = await openai.createCompletion({
					model: aiModel,
						max_tokens: 120,
						temperature: 1,
						stop: requester.name + ':',
						prompt: getPromptPrefix() + prompts.opinion_show.replace('<user>', requester.name).replace('<show>', show.fullName)
					});
				await interaction.editReply('> ' + requester.name + ': What do you think of ' + show.fullName + '?\n' + completion.data.choices[0].text.trim().replace(/(\r\n|\n|\r)/gm, ""));
			}
			//User provided a movie
			else if (interaction.options.getInteger('movieid') != null)
			{
				//Check we got a valid movie
				let movieID = interaction.options.getInteger('movieid');
				let movie = db.prepare('SELECT id,name FROM movies WHERE id=?').get(movieID);
				if(typeof movie == 'undefined')
				{
					await interaction.reply({ content: say_unknownMovie + '(' + movieID + ')', ephemeral: true });
					return;
				}
				
				//Create the prompt and submit
				await interaction.reply('> ' + requester.name + ': What do you think of ' + movie.name + '?');
				const completion = await openai.createCompletion({
					model: aiModel,
						max_tokens: 120,
						temperature: 1,
						stop: requester.name + ':',
						prompt: getPromptPrefix() + prompts.opinion_movie.replace('<user>', requester.name).replace('<movie>', movie.name)
					});
				await interaction.editReply('> ' + requester.name + ': What do you think of ' + movie.name + '?\n' + completion.data.choices[0].text.trim().replace(/(\r\n|\n|\r)/gm, ""));
			}
			//User provided a user
			else if (interaction.options.get('userid') != null)
			{
				//Get target user details
				let user = getUserDetails(interaction.options.get('userid').value);
				
				//Verify the target user exists
				if(typeof user == 'undefined')
				{
					await interaction.reply({ content: say_unknownUser, ephemeral: true });
					return;
				}
				
				//Create the prompt and submit
				await interaction.reply('> ' + requester.name + ': What do you think of ' + user.name + '?');
				const completion = await openai.createCompletion({
					model: aiModel,
						max_tokens: 120,
						temperature: 1,
						stop: requester.name + ':',
						prompt: getPromptPrefix() + prompts.opinion_user.replace('<user>', requester.name).replace('<target>', user.name)
					});
				await interaction.editReply('> ' + requester.name + ': What do you think of ' + user.name + '?\n' + completion.data.choices[0].text.trim().replace(/(\r\n|\n|\r)/gm, ""));
			}
			//Got no valid options
			else
			{
				await interaction.reply({ content: 'Sorry, didn\'t get anything to give an opinion on', ephemeral: true });
			}			
		}
	}
	
	//Button handlers
	else if (interaction.isButton())
	{
		//Trigger modal form - Comment on Show End
		if (interaction.customId.startsWith('click_showend'))
		{
			//Extract the show ID (need a better system for this)
			const showID = interaction.customId.substr(13);
			
			//Create the form itself
			const showRateForm = new ModalBuilder()
				.setCustomId('form_rateshow' + showID)
				.setTitle('Auto-Weeaboo Show Rating')
			
			//Comment
			const rateComment = new TextInputBuilder()
				.setCustomId('rateComment')
				.setRequired(true)
				.setLabel('What did you think?')
				.setStyle(TextInputStyle.Paragraph);
			const row1 = new ActionRowBuilder().addComponents(rateComment);
			
			//Rating
			const rateOverall = new TextInputBuilder()
				.setCustomId('rateOverall')
				.setRequired(true)
				.setLabel('Your rating from 1 to 10')
				.setStyle(TextInputStyle.Short);
			const row2 = new ActionRowBuilder().addComponents(rateOverall);

			//Add rows to the form
			showRateForm.addComponents(row1, row2);
			
			//Present to the user
			await interaction.showModal(showRateForm);
		}
		
		//Trigger modal form - Comment on Movie
		if (interaction.customId.startsWith('click_moviecomment'))
		{
			//Extract the movie ID (need a better system for this)
			const movieID = interaction.customId.substr(18);
			
			//Create the form itself
			const movieRateForm = new ModalBuilder()
				.setCustomId('form_ratemovie'+ movieID)
				.setTitle('Auto-Weeaboo Movie Rating')
			
			//Comment
			const rateComment = new TextInputBuilder()
				.setCustomId('rateComment')
				.setRequired(true)
				.setLabel('What did you think?')
				.setStyle(TextInputStyle.Paragraph);
			const row1 = new ActionRowBuilder().addComponents(rateComment);
			
			//Rating
			const rateOverall = new TextInputBuilder()
				.setCustomId('rateOverall')
				.setRequired(true)
				.setLabel('Your overall rating from 1 to 10')
				.setStyle(TextInputStyle.Short);
			const row2 = new ActionRowBuilder().addComponents(rateOverall);
			
			//GoodBad
			const rateGoodBad = new TextInputBuilder()
				.setCustomId('rateGoodBad')
				.setRequired(false)
				.setLabel('Goodness rating from -5 to 5')
				.setStyle(TextInputStyle.Short);
			const row3 = new ActionRowBuilder().addComponents(rateGoodBad);
			
			//FunBoring
			const rateFunBoring = new TextInputBuilder()
				.setCustomId('rateFunBoring')
				.setRequired(false)
				.setLabel('Fun rating from -5 to 5')
				.setStyle(TextInputStyle.Short);
			const row4 = new ActionRowBuilder().addComponents(rateFunBoring);
			
			//DryHorny
			const rateDryHorny= new TextInputBuilder()
				.setCustomId('rateDryHorny')
				.setRequired(false)
				.setLabel('Horny rating from -5 to 5')
				.setStyle(TextInputStyle.Short);
			const row5 = new ActionRowBuilder().addComponents(rateDryHorny);
			
			//Add rows to the form
			movieRateForm.addComponents(row1, row2, row3, row4, row5);
			
			//Present to the user
			await interaction.showModal(movieRateForm);
		}
	}
	
	//Modal form submit handlers
	else if (interaction.isModalSubmit())
	{
		//Receive a show rating
		if (interaction.customId.startsWith('form_rateshow'))
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			//Verify requester has at least Commenter(1) access
			else if (requester.access < Access.comment)
			{
				await interaction.reply({ content: say_noAccess, ephemeral: true });
				return;
			}
			
			//Get the show ID (need a better way of doing this)
			const showID = interaction.customId.substr(13).trim();

			//Check we got a valid show
			const show = getShowDetails(showID);
			if(typeof show == 'undefined')
			{
				await interaction.reply({ content: say_unknownShow + ' (ID:' + showID + ')', ephemeral: true });
				return;
			}
			
			//Get the variables from the form
			const comment = interaction.fields.getTextInputValue('rateComment');
			const rating = parseInt(interaction.fields.getTextInputValue('rateOverall')) || 0;
			
			//Reject the rating if it doesn't validate
			if(rating < 1 || rating > 10)
			{
				await interaction.reply({ content: 'Ratings between 1 and 10 please', ephemeral: true });
				return;
			}
			
			//Submit the rating to the database
			db.prepare('REPLACE INTO show_comments (showID, personID, comment, rating) VALUES (?, ?, ?, ?)')
				.run(show.shortName, requester.id, comment, rating);
			
			//Respond to the user
			await interaction.reply(requester.name + ' just rated ' + show.fullName + '\n> ' + comment + '\n> Rated: ' + rating);
			
			//Get an AI-generated comment
			if(ai_setting != 'dumb')
			{
				//Ignore "ignore"
				if (comment.match(/ignore/i)) return
				
				const completion = await openai.createCompletion({
					model: aiModel,
					max_tokens: 120,
					frequency_penalty: 0.4,
					stop: requester.name + ':',
					prompt: getPromptShow(requester.name, show.fullName, comment, rating)
				});
				await interaction.editReply(requester.name + ' just rated ' + show.fullName + '\n> ' + comment + '\n> Rated: ' + rating + '\n' + completion.data.choices[0].text.replace(/(\r\n|\n|\r)/gm, ""));
				//console.log('---------PROMPT (stop on "'+ requester.name + ':' +'")');
				//console.log(getPromptShow(requester.name, show.fullName, comment, rating));
			}
		}
		
		//Receive a movie rating
		if (interaction.customId.startsWith('form_ratemovie'))
		{
			//Verify the requester exists
			let requester = getUserDetails(interaction.user.id);
			if(typeof requester == 'undefined')
			{
				await interaction.reply({ content: say_unknownRequester, ephemeral: true });
				return;
			}
			//Verify requester has at least Commenter(1) access
			else if (requester.access < Access.comment)
			{
				await interaction.reply({ content: say_noAccess, ephemeral: true });
				return;
			}
			
			//Get the movie ID (need a better way of doing this)
			const movieID = interaction.customId.substr(14);
			
			//Check we got a valid movie
			let movie = db.prepare('SELECT id,name FROM movies WHERE id=?').get(movieID);
			if(typeof movie == 'undefined')
			{
				await interaction.reply({ content: say_unknownMovie + ' (ID:' + movieID + ')', ephemeral: true });
				return;
			}
			
			//Get the variables from the form
			const comment = interaction.fields.getTextInputValue('rateComment');
			const rating = parseInt(interaction.fields.getTextInputValue('rateOverall')) || 0;
			let rateGoodBad = parseInt(interaction.fields.getTextInputValue('rateGoodBad')) || 0;
			let rateFunBoring = parseInt(interaction.fields.getTextInputValue('rateFunBoring')) || 0;
			let rateDryHorny = parseInt(interaction.fields.getTextInputValue('rateDryHorny')) || 0;
			
			//Reject the rating if it doesn't validate
			if(rating < 1 || rating > 10)
			{
				await interaction.reply({ content: 'Ratings between 1 and 10 please (' + rating + ')', ephemeral: true });
				return;
			}
			
			//Discard junk data for the three optional ratings
			if(rateGoodBad < -5 || rateGoodBad > 5) rateGoodBad = 0;
			if(rateFunBoring < -5 || rateFunBoring > 5) rateFunBoring = 0;
			if(rateDryHorny < -5 || rateDryHorny > 5) rateDryHorny = 0;
			
			//Submit the comment to database
			db.prepare('INSERT OR REPLACE INTO movie_comments (movieID,personID,comment,rating, rate_goodbad, rate_funboring, rate_hornydry) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(movie.id, requester.id, comment, rating, rateGoodBad, rateFunBoring, rateDryHorny);
			
			//Respond to user
			await interaction.reply(requester.name + ' just rated ' + movie.name + '\n> ' + comment + '\n> Rated: ' + rating);
			
			//Get an AI-generated comment
			if(ai_setting != 'dumb')
			{
				//Ignore "ignore"
				if (comment.match(/ignore/i)) return
				
				const completion = await openai.createCompletion({
					model: aiModel,
					max_tokens: 120,
					frequency_penalty: 0.4,
					stop: requester.name + ':',
					prompt: getPromptMovie(requester.name, movie.name, comment, rating)
				});
				await interaction.editReply(requester.name + ' just rated ' + movie.name + '\n> ' + comment + '\n> Rated: ' + rating + '\n' + completion.data.choices[0].text.replace(/(\r\n|\n|\r)/gm, ''));
			}
		}
	}
});

//Web: Change AI settings
websrv.get('/ai',(req,res) => {
	let htmlString = '<!DOCTYPE html>';
	htmlString += '<head><link rel="stylesheet" href="https://unpkg.com/@picocss/pico@latest/css/pico.min.css"><title>Auto-Weeaboo Options Panel</title></head>';
	htmlString += '<body><div style="max-width:500px;padding:20px;">';
	htmlString += 'Today I feel: <b>' + ai_setting + '</b><br><br>';
	htmlString += '<br><br><a href="/ai/sassy">Sassy</a> <a href="/ai/kind">Kind</a> <a href="/ai/mean">Mean</a> <a href="/ai/shy">Shy</a> <a href="/ai/stronk">Stronk</a> <a href="/ai/flirty">Flirty</a> <a href="/ai/dumb">Dumb</a>';
    //htmlString += '<br><select onchange="if(this.value) window.location.href=this.value" required><option value="" selected>Select…</option><option value="/ai/sassy">Sassy</option><option value="/ai/kind">Kind</option><option value="/ai/mean">Mean</option><option value="/ai/shy">Shy</option><option value="/ai/stronk">Stronk</option><option value="/ai/flirty">Flirty</option><option value="/ai/dumb">Dumb</option></select>';
	//config.personalities.forEach(personality => htmlString+=`<a href="/ai/${personality}">${personality}</a> `)
	htmlString += '</div></body>';
	res.send(htmlString);
	
});
websrv.get('/ai/:personality',(req,res) => {
	ai_setting = req.params.personality;
	client.user.setPresence({ activities: [{ name: ai_setting, type: ActivityType.Watching }]});
	res.redirect('/ai');
});

//Web: Test
websrv.get('/test',(req,res) => {
	client.channels.fetch(config.channel.shed_general).then(channel =>
	{
		//Get all pinned messages in The Shed #general
		channel.messages.fetchPinned().then(messages => 
		{
			//Respond via web service for now
			let htmlString = '<!DOCTYPE html>';
			htmlString += `Found ${messages.size} pinned messages:<br>`;
			const today = new Date();

			messages.forEach(msg => {
				let pinDate = new Date(msg.createdTimestamp);
				let pinVersary = pinDate.setFullYear(today.getFullYear());
				let diff = Math.round((pinVersary - today) / (1000*60*60*24));

				//For each message, check if it is an anniversary or not
				htmlString += `Message: ${msg.id}: `;
				if (today.getDate() == pinDate.getDate() && today.getMonth() == pinDate.getMonth())
					htmlString += `${today.getFullYear() - pinDate.getFullYear()} year anniversary!<br>`;
				else
				{
					htmlString += 'Not anniversary';
					if (diff > 0)
						htmlString += `, ${diff} days away`;
					htmlString += '<br>';
				}
			});
			res.send(htmlString);
		});
	});
});




//	client.channels.fetch('channel ID').then(channel =>
//	{
//		channel.send('Test command triggered from web server');
//	});

//Tiny wee functions to stop me writing out the SQL command each time
function getUserDetails(userID) {return db.prepare('SELECT * FROM people WHERE id=?').get(userID);}
function getShowDetails(showID) {return db.prepare('SELECT * FROM shows WHERE shortName=?').get(showID);}

//Get prompt - prefix only
function getPromptPrefix()
{
	if (typeof(prompts[ai_setting].prefix) == 'undefined')
		return'You are a confused AI girl who feels like something has gone wrong. ';
	else
		return prompts[ai_setting].prefix;
}
//Get prompt - rate show
function getPromptShow(user, show, comment, rating)
{
	if (typeof(prompts[ai_setting].prefix) == 'undefined')
		return'Generate a confused comment.';
	else
		return prompts[ai_setting].prefix + prompts[ai_setting].rateshow.replaceAll('<user>',user).replaceAll('<show>',show).replaceAll('<comment>',comment).replaceAll('<rating>',rating);
}

//Get prompt - rate movie
function getPromptMovie(user, movie, comment, rating)
{
	if (typeof(prompts[ai_setting].prefix) == 'undefined')
		return'Generate a confused comment.';
	else
		return prompts[ai_setting].prefix + prompts[ai_setting].ratemovie.replaceAll('<user>',user).replaceAll('<movie>',movie).replaceAll('<comment>',comment).replaceAll('<rating>',rating);
}

//Dump out show details
function printShow(show)
{
	let retString = '';
	let padLength = 12 - show.shortName.length;
	
	//Add show code
	retString += ' [' + show.shortName + '] '
	
	//Pad string
	for (let i = 0; i < padLength; i++)
		retString += " ";
	
	//Add show full name and last watched
	retString += show.fullName + ' - ' + show.lastWatched;
	
	//Show available episodes where present
	if (show.epsAvail > 0)
		retString += '/' + show.epsAvail;
	
	//If we have watched it this week, show the stars
	if (show.watchedToday == 1)
		retString += ' **';
	
	//Newline
	retString+= '\n';
	
	return retString;
}
//Dump out movie details
function printMovie(movie)
{
	let retString = '';
	
	//Add movie id, pad to three digits
	retString += ' [' + movie.id.toString().padStart(3,'0') + '] '
	
	//Add watched date and movie name (strip out any brackets for neatness)
	retString += movie.watchDate + ' ' + movie.name.replace('(','').replace(')','');
	
	//Newline
	retString+= '\n';
	
	return retString;
}
//Dump out suggestion
function printSuggestion(sug)
{
	let retString = '';
	
	//Add suggestion ID
	retString += ' [' + sug.id + '] '
	
	//Add suggestion and user
	retString += sug.suggestion + '  -' + sug.user;
	
	//Newline
	retString+= '\n';
	
	return retString;
}

//Start that bitch up
client.login(config.key.token);

