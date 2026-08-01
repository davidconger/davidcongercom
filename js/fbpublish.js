function streamPublish(){

//var metaTags = document.getElementsByTagName('meta');
var metaUrl = location.href;

//for(var i=0; i < metaTags.length; i++)
//{
//	if (metaTags[i].name == 'og:url')
//		metaUrl = metaTags[i].content;
//}

 FB.ui(
   {
     method: 'stream.publish',
     message: '',
     link: metaUrl,
     action_links: [
       { text: 'View', href: metaUrl }
     ],
     user_message_prompt: 'Add a message to your post'
   },
   function(response) { }
 );
}
